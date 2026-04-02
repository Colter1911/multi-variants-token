import { MODULE_ID } from "../constants.mjs";

/**
 * Сервис для автоматического создания круглых токенов из изображений
 * с детекцией лица через face-api.js (TinyFaceDetector).
 *
 * Использование:
 *   const service = AutoTokenService.instance();
 *   await service.init();
 *   const blob = await service.createTokenBlob(imageSrc, 2.5);
 */

const MODEL_PATH = `modules/${MODULE_ID}/models`;
const TOKEN_SIZE = 512;
const CUSTOM_FRAME_TOKEN_SIZE = 1024;
const MANUAL_SOURCE_CROP_SCALE = 2;
const INNER_SCALE = 0.85;

let _instance = null;
let _modelsLoaded = false;

export class AutoTokenService {

    /**
     * Получить синглтон-экземпляр сервиса.
     * @returns {AutoTokenService}
     */
    static instance() {
        if (!_instance) {
            _instance = new AutoTokenService(MODEL_PATH);
        }
        return _instance;
    }

    /**
     * @param {string} modelPath — путь к папке с весами нейросети (относительно Foundry)
     */
    constructor(modelPath) {
        this.modelPath = modelPath;
    }

    /**
     * Загружает модель TinyFaceDetector (один раз).
     */
    async init() {
        if (_modelsLoaded) return;

        if (typeof faceapi === "undefined") {
            throw new Error("[MTA AutoToken] face-api.js не загружен. Проверьте module.json → scripts.");
        }

        await faceapi.nets.tinyFaceDetector.loadFromUri(this.modelPath);
        _modelsLoaded = true;
        console.log("[MTA AutoToken] TinyFaceDetector модель загружена.");
    }

    /**
     * Создаёт круглый токен из изображения.
     *
     * @param {string|HTMLImageElement} imageSource — URL или HTMLImageElement
     * @param {number} [scaleFactor=2.5] — множитель зума (чем больше — тем больше захват вокруг лица)
     * @returns {Promise<{blob: Blob, faceCoordinates: object|null}>}
     */
    async createTokenBlob(imageSource, scaleFactor = 2.5) {
        await this.init();

        // --- Шаг Б: Загрузка изображения ---
        const img = await this._loadImage(imageSource);

        const imgWidth = img.naturalWidth || img.width;
        const imgHeight = img.naturalHeight || img.height;

        console.log(`[MTA AutoToken] Image loaded. Size: ${imgWidth}x${imgHeight} (Natural: ${img.naturalWidth}x${img.naturalHeight})`);

        // --- Шаг Б: Детекция лица (Dual Pass Strategy) ---

        let detection = null;

        // Pass 1: Try detection on the raw image first. 
        // This preserves maximum detail for high-contrast/stylized art which might lose quality on canvas.
        try {
            detection = await faceapi.detectSingleFace(
                img,
                new faceapi.TinyFaceDetectorOptions({
                    inputSize: 608, // Increased resolution for better detection on detailed art
                    scoreThreshold: 0.4 // Higher threshold to avoid false positives
                })
            );
        } catch (e) {
            console.warn("[MTA AutoToken] Pass 1 (Raw) error:", e);
        }

        // Pass 2: If no face found or error, try using a Proxy Canvas.
        // This helps with:
        // 1. WebP/SVG transparency issues (we fill BG with gray).
        // 2. Browser-specific decoding quirks.
        if (!detection) {
            console.log("[MTA AutoToken] Pass 1 (Raw) failed. Retrying with Proxy Canvas...");

            const proxyCanvas = document.createElement("canvas");
            proxyCanvas.width = imgWidth;
            proxyCanvas.height = imgHeight;
            const proxyCtx = proxyCanvas.getContext("2d");

            // Fill with neutral gray to handle transparency (helps with WebP/PNG detection)
            proxyCtx.fillStyle = "#808080";
            proxyCtx.fillRect(0, 0, imgWidth, imgHeight);

            proxyCtx.drawImage(img, 0, 0);

            detection = await faceapi.detectSingleFace(
                proxyCanvas,
                new faceapi.TinyFaceDetectorOptions({
                    inputSize: 512,
                    scoreThreshold: 0.4 // Standard threshold for fallback
                })
            );
        }

        let faceCenterX, faceCenterY, faceHeight;
        let faceCoordinates = null;

        if (detection) {
            const box = detection.box;
            faceCenterX = box.x + box.width / 2;
            faceCenterY = box.y + box.height / 2;
            faceHeight = box.height;
            faceCoordinates = { x: box.x, y: box.y, width: box.width, height: box.height };
            console.log("[MTA AutoToken] Лицо обнаружено:", faceCoordinates);
        } else {
            // Фоллбэк: центр изображения, размер лица = 50% высоты
            faceCenterX = imgWidth / 2;
            faceCenterY = imgHeight / 2;
            faceHeight = imgHeight * 0.5;
            console.log("[MTA AutoToken] Лицо не обнаружено, используется центр изображения как фоллбэк.");
        }

        // --- Шаг В: Вычисление геометрии (Safe Crop with Shift) ---
        const cropRect = this._createSafeCropRect({
            centerX: faceCenterX,
            centerY: faceCenterY,
            cropSize: faceHeight * scaleFactor,
            imgWidth,
            imgHeight
        });

        console.log(`[MTA AutoToken] Final Draw Coords: sx=${cropRect.sx}, sy=${cropRect.sy}, size=${cropRect.sw}x${cropRect.sh} from ${imgWidth}x${imgHeight}`);

        try {
            const { canvas } = this._renderTokenCanvasFromCrop({
                img,
                sx: cropRect.sx,
                sy: cropRect.sy,
                sw: cropRect.sw,
                sh: cropRect.sh
            });

            // --- Шаг Д: Вывод ---
            const blob = await this._canvasToWebpBlob(canvas);

            return { blob, faceCoordinates };
        } catch (err) {
            console.error("[MTA AutoToken] Error generating token blob:", err);
            throw err;
        }

    }

    /**
     * Создаёт круглый токен из ручной области (центр + размер квадрата в px исходника).
     * Не требует face detection. Для ручного режима расширяет source-crop,
     * но сохраняет итоговый размер токена и dynamic ring в масштабе x1.
     *
     * @param {object} params
     * @param {string|HTMLImageElement} params.imageSource
     * @param {number} params.centerX
     * @param {number} params.centerY
     * @param {number} params.cropSize
     * @param {Array<Array<{x:number, y:number}>>} [params.alphaPolygons]
     * @param {{image:HTMLImageElement, offsetX:number, offsetY:number, scale:number}|null} [params.customFrame]
     * @param {number} [params.canvasSize]
     * @param {number} [params.compositionScale=1]
     * @param {boolean} [params.allowOverflowCanvas=false]
     * @returns {Promise<{blob: Blob, cropRect: object, renderMetadata: object}>}
     */
    async createTokenBlobFromSelection({ imageSource, centerX, centerY, cropSize, alphaPolygons = null, customFrame = null, canvasSize = null, compositionScale = 1, allowOverflowCanvas = false }) {
        const img = await this._loadImage(imageSource);
        const imgWidth = img.naturalWidth || img.width;
        const imgHeight = img.naturalHeight || img.height;

        const cropRect = this._createSafeCropRect({
            centerX,
            centerY,
            cropSize: cropSize * MANUAL_SOURCE_CROP_SCALE,
            imgWidth,
            imgHeight
        });

        const { canvas, metadata } = this._renderTokenCanvasFromCrop({
            img,
            sx: cropRect.sx,
            sy: cropRect.sy,
            sw: cropRect.sw,
            sh: cropRect.sh,
            alphaPolygons,
            customFrame,
            canvasSize,
            compositionScale,
            allowOverflowCanvas
        });

        const blob = await this._canvasToWebpBlob(canvas);
        return { blob, cropRect, renderMetadata: metadata };
    }

    /**
     * Быстрый рендер превью токена из ручной области.
     * Превью использует тот же расширенный source-crop, что и финальный manual export.
     *
     * @param {object} params
     * @param {HTMLImageElement} params.image
     * @param {number} params.centerX
     * @param {number} params.centerY
     * @param {number} params.cropSize
     * @param {Array<Array<{x:number, y:number}>>} [params.alphaPolygons]
     * @param {{image:HTMLImageElement, offsetX:number, offsetY:number, scale:number}|null} [params.customFrame]
     * @param {number} [params.canvasSize]
     * @param {number} [params.compositionScale=1]
     * @param {boolean} [params.allowOverflowCanvas=false]
     * @returns {{canvas: HTMLCanvasElement, metadata: object}}
     */
    createTokenCanvasFromSelection({ image, centerX, centerY, cropSize, alphaPolygons = null, customFrame = null, canvasSize = null, compositionScale = 1, allowOverflowCanvas = false }) {
        const img = image;
        if (!(img instanceof HTMLImageElement)) {
            throw new Error("[MTA AutoToken] createTokenCanvasFromSelection: image must be HTMLImageElement.");
        }

        const imgWidth = img.naturalWidth || img.width;
        const imgHeight = img.naturalHeight || img.height;

        const cropRect = this._createSafeCropRect({
            centerX,
            centerY,
            cropSize: cropSize * MANUAL_SOURCE_CROP_SCALE,
            imgWidth,
            imgHeight
        });

        return this._renderTokenCanvasFromCrop({
            img,
            sx: cropRect.sx,
            sy: cropRect.sy,
            sw: cropRect.sw,
            sh: cropRect.sh,
            alphaPolygons,
            customFrame,
            canvasSize,
            compositionScale,
            allowOverflowCanvas
        });
    }

    /**
     * Вычисляет безопасный квадратный crop: центр + размер -> sx/sy/sw/sh в пределах изображения.
     * @private
     */
    _createSafeCropRect({ centerX, centerY, cropSize, imgWidth, imgHeight }) {
        const safeCenterX = Number.isFinite(centerX) ? centerX : imgWidth / 2;
        const safeCenterY = Number.isFinite(centerY) ? centerY : imgHeight / 2;

        let safeCropSize = Number.isFinite(cropSize) ? cropSize : Math.min(imgWidth, imgHeight);
        if (safeCropSize <= 0) safeCropSize = Math.min(imgWidth, imgHeight);

        // 1. Cap crop size to the smallest dimension of the image
        const maxPossibleSize = Math.min(imgWidth, imgHeight);
        if (safeCropSize > maxPossibleSize) {
            safeCropSize = maxPossibleSize;
        }

        const halfCrop = safeCropSize / 2;

        // 2. Calculate initial top-left corner
        let sx = safeCenterX - halfCrop;
        let sy = safeCenterY - halfCrop;

        // 3. Shift/Clamp to keep within image boundaries
        if (sx < 0) sx = 0;
        if (sx + safeCropSize > imgWidth) sx = imgWidth - safeCropSize;

        if (sy < 0) sy = 0;
        if (sy + safeCropSize > imgHeight) sy = imgHeight - safeCropSize;

        // Final Integer Rounding
        let sw = Math.floor(safeCropSize);
        let sh = Math.floor(safeCropSize);
        sx = Math.floor(sx);
        sy = Math.floor(sy);

        // Aspect Ratio Safe Clamp
        if (sx + sw > imgWidth) {
            const diff = (sx + sw) - imgWidth;
            sw -= diff;
            sh -= diff;
        }
        if (sy + sh > imgHeight) {
            const diff = (sy + sh) - imgHeight;
            sw -= diff;
            sh -= diff;
        }

        if (sw < 1) sw = 1;
        if (sh < 1) sh = 1;

        return { sx, sy, sw, sh };
    }

    /**
     * Рендерит квадратный canvas из квадратного crop исходного изображения.
     * Ручной режим расширяет source-crop до вызова этого метода, поэтому итоговая композиция
     * остаётся в масштабе x1 без отдельного scaleCorrection у dynamic ring.
     * @private
     */
    _renderTokenCanvasFromCrop({ img, sx, sy, sw, sh, alphaPolygons = null, customFrame = null, canvasSize = null, compositionScale = 1, allowOverflowCanvas = false }) {
        const baseCanvasSize = Math.max(1, Math.round(Number.isFinite(canvasSize) ? canvasSize : (customFrame?.image ? CUSTOM_FRAME_TOKEN_SIZE : TOKEN_SIZE)));
        const safeCompositionScale = Math.max(0.05, Number.isFinite(compositionScale) ? compositionScale : 1);
        const baseCanvasCenter = baseCanvasSize / 2;

        const imgWidth = img.naturalWidth || img.width;
        const imgHeight = img.naturalHeight || img.height;

        // Финальная маска: БАЗОВЫЙ КРУГ + (union) ДОПОЛНИТЕЛЬНЫЕ alpha-полигоны.
        // Это даёт ожидаемое поведение: "круговой токен + добавленные вырезки по альфе".
        const validOperations = Array.isArray(alphaPolygons)
            ? alphaPolygons
                .map((entry) => {
                    if (Array.isArray(entry)) {
                        return { operation: "add", points: entry };
                    }

                    const points = entry?.points;
                    if (!Array.isArray(points)) return null;
                    return {
                        operation: entry?.operation === "subtract" ? "subtract" : "add",
                        points
                    };
                })
                .filter((entry) => Array.isArray(entry?.points) && entry.points.length >= 3)
            : [];

        // Добавка: пользовательские полигоны в координатах source → token
        const traceSmoothClosedPolygon = (context, polygon, mapPoint) => {
            if (!Array.isArray(polygon) || polygon.length < 3) return;

            const mapped = polygon.map(mapPoint);
            if (mapped.length < 3) return;

            const first = mapped[0];
            const second = mapped[1];
            const startX = (first.x + second.x) / 2;
            const startY = (first.y + second.y) / 2;

            context.moveTo(startX, startY);

            for (let i = 1; i < mapped.length; i++) {
                const current = mapped[i];
                const next = mapped[(i + 1) % mapped.length];
                const midX = (current.x + next.x) / 2;
                const midY = (current.y + next.y) / 2;
                context.quadraticCurveTo(current.x, current.y, midX, midY);
            }

            context.closePath();
        };

        const computeGeometry = ({
            compositionScale: nextCompositionScale = safeCompositionScale,
            drawOffsetX = 0,
            drawOffsetY = 0
        } = {}) => {
            const innerSize = baseCanvasSize * INNER_SCALE * nextCompositionScale;
            const innerRadius = innerSize / 2;
            const offsetX = ((baseCanvasSize - innerSize) / 2) + drawOffsetX;
            const offsetY = ((baseCanvasSize - innerSize) / 2) + drawOffsetY;
            const sourceToTokenScale = innerSize / Math.max(1, sw);
            const destX = offsetX - (sx * sourceToTokenScale);
            const destY = offsetY - (sy * sourceToTokenScale);
            const destW = imgWidth * sourceToTokenScale;
            const destH = imgHeight * sourceToTokenScale;
            const centerX = baseCanvasCenter + drawOffsetX;
            const centerY = baseCanvasCenter + drawOffsetY;

            let frameRect = null;
            if (customFrame?.image) {
                const { image: frameImg, offsetX: fOffX = 0, offsetY: fOffY = 0, scale: fScale = 1.0 } = customFrame;
                const frameNatW = frameImg.naturalWidth || frameImg.width || baseCanvasSize;
                const frameNatH = frameImg.naturalHeight || frameImg.height || baseCanvasSize;
                const maxDim = Math.max(frameNatW, frameNatH, 1);
                const frameTargetSize = baseCanvasSize * fScale * nextCompositionScale;
                const width = frameTargetSize * frameNatW / maxDim;
                const height = frameTargetSize * frameNatH / maxDim;
                const frameCenterX = centerX + fOffX;
                const frameCenterY = centerY + fOffY;
                frameRect = {
                    image: frameImg,
                    x: frameCenterX - (width / 2),
                    y: frameCenterY - (height / 2),
                    width,
                    height
                };
            }

            return {
                innerSize,
                innerRadius,
                offsetX,
                offsetY,
                centerX,
                centerY,
                sourceToTokenScale,
                destX,
                destY,
                destW,
                destH,
                frameRect
            };
        };

        const computeContentBounds = (geometry) => {
            let minX = geometry.centerX - geometry.innerRadius;
            let maxX = geometry.centerX + geometry.innerRadius;
            let minY = geometry.centerY - geometry.innerRadius;
            let maxY = geometry.centerY + geometry.innerRadius;

            for (const entry of validOperations) {
                if (entry.operation !== "add") continue;
                for (const point of entry.points) {
                    const mappedX = geometry.offsetX + ((point.x - sx) * geometry.sourceToTokenScale);
                    const mappedY = geometry.offsetY + ((point.y - sy) * geometry.sourceToTokenScale);
                    if (mappedX < minX) minX = mappedX;
                    if (mappedX > maxX) maxX = mappedX;
                    if (mappedY < minY) minY = mappedY;
                    if (mappedY > maxY) maxY = mappedY;
                }
            }

            if (geometry.frameRect) {
                minX = Math.min(minX, geometry.frameRect.x);
                maxX = Math.max(maxX, geometry.frameRect.x + geometry.frameRect.width);
                minY = Math.min(minY, geometry.frameRect.y);
                maxY = Math.max(maxY, geometry.frameRect.y + geometry.frameRect.height);
            }

            return { minX, maxX, minY, maxY };
        };

        const baseGeometry = computeGeometry();
        const baseBounds = allowOverflowCanvas ? computeContentBounds(baseGeometry) : null;
        const overflowLeft = baseBounds ? Math.max(0, -baseBounds.minX) : 0;
        const overflowRight = baseBounds ? Math.max(0, baseBounds.maxX - baseCanvasSize) : 0;
        const overflowTop = baseBounds ? Math.max(0, -baseBounds.minY) : 0;
        const overflowBottom = baseBounds ? Math.max(0, baseBounds.maxY - baseCanvasSize) : 0;

        const minCanvasWidth = baseCanvasSize + overflowLeft + overflowRight;
        const minCanvasHeight = baseCanvasSize + overflowTop + overflowBottom;
        const finalCanvasSize = Math.max(
            baseCanvasSize,
            Math.ceil(allowOverflowCanvas ? Math.max(minCanvasWidth, minCanvasHeight) : baseCanvasSize)
        );

        const drawOffsetX = allowOverflowCanvas
            ? Math.ceil(overflowLeft + ((finalCanvasSize - minCanvasWidth) / 2))
            : 0;
        const drawOffsetY = allowOverflowCanvas
            ? Math.ceil(overflowTop + ((finalCanvasSize - minCanvasHeight) / 2))
            : 0;

        const geometry = computeGeometry({
            compositionScale: safeCompositionScale,
            drawOffsetX,
            drawOffsetY
        });
        const {
            innerRadius,
            offsetX,
            offsetY,
            centerX,
            centerY,
            sourceToTokenScale,
            destX,
            destY,
            destW,
            destH,
            frameRect
        } = geometry;

        // --- Final Token Canvas ---
        const canvas = document.createElement("canvas");
        canvas.width = finalCanvasSize;
        canvas.height = finalCanvasSize;
        const ctx = canvas.getContext("2d");

        // Очистка (по умолчанию прозрачный)
        ctx.clearRect(0, 0, finalCanvasSize, finalCanvasSize);

        const createSubjectLayer = () => {
            const layerCanvas = document.createElement("canvas");
            layerCanvas.width = finalCanvasSize;
            layerCanvas.height = finalCanvasSize;
            const layerCtx = layerCanvas.getContext("2d");
            layerCtx.clearRect(0, 0, finalCanvasSize, finalCanvasSize);
            layerCtx.imageSmoothingEnabled = true;
            layerCtx.imageSmoothingQuality = "high";
            layerCtx.drawImage(img, destX, destY, destW, destH);
            return { canvas: layerCanvas, ctx: layerCtx };
        };

        const buildMaskCanvas = ({ includeCircle = true, includeAdditions = true, includeSubtractions = true } = {}) => {
            const maskCanvas = document.createElement("canvas");
            maskCanvas.width = finalCanvasSize;
            maskCanvas.height = finalCanvasSize;
            const maskCtx = maskCanvas.getContext("2d");

            maskCtx.clearRect(0, 0, finalCanvasSize, finalCanvasSize);
            maskCtx.fillStyle = "#ffffff";

            if (includeCircle) {
                maskCtx.beginPath();
                maskCtx.arc(centerX, centerY, innerRadius, 0, Math.PI * 2);
                maskCtx.closePath();
                maskCtx.fill();
            }

            if (validOperations.length > 0) {
                for (const entry of validOperations) {
                    if (entry.operation === "add" && !includeAdditions) continue;
                    if (entry.operation === "subtract" && !includeSubtractions) continue;

                    maskCtx.save();
                    maskCtx.globalCompositeOperation = entry.operation === "subtract" ? "destination-out" : "source-over";
                    maskCtx.fillStyle = "#ffffff";
                    maskCtx.beginPath();
                    traceSmoothClosedPolygon(maskCtx, entry.points, (point) => ({
                        x: offsetX + ((point.x - sx) * sourceToTokenScale),
                        y: offsetY + ((point.y - sy) * sourceToTokenScale)
                    }));
                    maskCtx.fill();
                    maskCtx.restore();
                }
            }

            return maskCanvas;
        };

        const drawMaskedSubjectLayer = (maskCanvas) => {
            const { canvas: layerCanvas, ctx: layerCtx } = createSubjectLayer();
            if (maskCanvas) {
                layerCtx.save();
                layerCtx.globalCompositeOperation = "destination-in";
                layerCtx.drawImage(maskCanvas, 0, 0);
                layerCtx.restore();
            }
            ctx.drawImage(layerCanvas, 0, 0);
        };

        const finalMaskCanvas = buildMaskCanvas({
            includeCircle: true,
            includeAdditions: true,
            includeSubtractions: true
        });

        drawMaskedSubjectLayer(finalMaskCanvas);

        if (frameRect) {
            ctx.save();
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(frameRect.image, frameRect.x, frameRect.y, frameRect.width, frameRect.height);
            ctx.restore();

            const hasAdditiveAlpha = validOperations.some((entry) => entry.operation === "add");
            if (hasAdditiveAlpha) {
                const alphaOverlayMaskCanvas = buildMaskCanvas({
                    includeCircle: false,
                    includeAdditions: true,
                    includeSubtractions: true
                });
                drawMaskedSubjectLayer(alphaOverlayMaskCanvas);
            }
        }

        return {
            canvas,
            metadata: {
                baseCanvasSize,
                finalCanvasSize,
                viewportX: drawOffsetX,
                viewportY: drawOffsetY,
                viewportSize: baseCanvasSize,
                textureScale: finalCanvasSize / Math.max(1, baseCanvasSize),
                compositionScale: safeCompositionScale,
                allowOverflowCanvas: Boolean(allowOverflowCanvas)
            }
        };
    }

    /**
     * @private
     */
    async _canvasToWebpBlob(canvas, quality = 0.85) {
        const blob = await new Promise((resolve) => {
            canvas.toBlob((b) => resolve(b), "image/webp", quality);
        });

        if (!blob) {
            throw new Error("Canvas toBlob failed (empty or corrupt image data).");
        }

        return blob;
    }

    /**
     * Загружает изображение с поддержкой CORS.
     * @param {string|HTMLImageElement} source
     * @returns {Promise<HTMLImageElement>}
     * @private
     */
    _loadImage(source) {
        if (source instanceof HTMLImageElement && source.complete && source.naturalWidth > 0) {
            return Promise.resolve(source);
        }

        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";

            const onLoad = async () => {
                try {
                    await img.decode(); // Ensure completely decoded
                    resolve(img);
                } catch (e) {
                    console.warn("[MTA AutoToken] img.decode() failed, falling back to onload result.", e);
                    resolve(img);
                }
            };

            img.onload = onLoad;
            img.onerror = (err) => reject(new Error(`[MTA AutoToken] Не удалось загрузить изображение: ${source}`));
            img.src = typeof source === "string" ? source : source.src;
        });
    }
}
