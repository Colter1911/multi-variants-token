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
            const canvas = this._renderTokenCanvasFromCrop({
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
     * Не требует face detection.
     *
     * @param {object} params
     * @param {string|HTMLImageElement} params.imageSource
     * @param {number} params.centerX
     * @param {number} params.centerY
     * @param {number} params.cropSize
     * @param {Array<Array<{x:number, y:number}>>} [params.alphaPolygons] — полигоны в координатах исходника
     * @returns {Promise<{blob: Blob, cropRect: {sx:number, sy:number, sw:number, sh:number}}>} 
     */
    async createTokenBlobFromSelection({ imageSource, centerX, centerY, cropSize, alphaPolygons = null }) {
        const img = await this._loadImage(imageSource);
        const imgWidth = img.naturalWidth || img.width;
        const imgHeight = img.naturalHeight || img.height;

        const cropRect = this._createSafeCropRect({
            centerX,
            centerY,
            cropSize,
            imgWidth,
            imgHeight
        });

        const canvas = this._renderTokenCanvasFromCrop({
            img,
            sx: cropRect.sx,
            sy: cropRect.sy,
            sw: cropRect.sw,
            sh: cropRect.sh,
            alphaPolygons
        });

        const blob = await this._canvasToWebpBlob(canvas);
        return { blob, cropRect };
    }

    /**
     * Быстрый рендер превью токена из ручной области. Возвращает canvas TOKEN_SIZE.
     *
     * @param {object} params
     * @param {HTMLImageElement} params.image
     * @param {number} params.centerX
     * @param {number} params.centerY
     * @param {number} params.cropSize
     * @param {Array<Array<{x:number, y:number}>>} [params.alphaPolygons] — полигоны в координатах исходника
     * @returns {HTMLCanvasElement}
     */
    createTokenCanvasFromSelection({ image, centerX, centerY, cropSize, alphaPolygons = null }) {
        const img = image;
        if (!(img instanceof HTMLImageElement)) {
            throw new Error("[MTA AutoToken] createTokenCanvasFromSelection: image must be HTMLImageElement.");
        }

        const imgWidth = img.naturalWidth || img.width;
        const imgHeight = img.naturalHeight || img.height;

        const cropRect = this._createSafeCropRect({
            centerX,
            centerY,
            cropSize,
            imgWidth,
            imgHeight
        });

        return this._renderTokenCanvasFromCrop({
            img,
            sx: cropRect.sx,
            sy: cropRect.sy,
            sw: cropRect.sw,
            sh: cropRect.sh,
            alphaPolygons
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
     * Рендерит TOKEN_SIZE canvas из квадратного crop исходного изображения.
     * @private
     */
    _renderTokenCanvasFromCrop({ img, sx, sy, sw, sh, alphaPolygons = null }) {
        // --- Final Token Canvas ---
        const canvas = document.createElement("canvas");
        canvas.width = TOKEN_SIZE;
        canvas.height = TOKEN_SIZE;
        const ctx = canvas.getContext("2d");

        // Очистка (по умолчанию прозрачный)
        ctx.clearRect(0, 0, TOKEN_SIZE, TOKEN_SIZE);

        // Масштаб 0.85 — чтобы круг вписывался внутрь Dynamic Ring
        const innerSize = TOKEN_SIZE * INNER_SCALE;
        const innerRadius = innerSize / 2;
        const offset = (TOKEN_SIZE - innerSize) / 2;

        const imgWidth = img.naturalWidth || img.width;
        const imgHeight = img.naturalHeight || img.height;

        // Рисуем всё исходное изображение в координатах токена через transform,
        // где [sx..sx+sw] x [sy..sy+sh] проецируется на innerSize.
        // Это важно для ручной альфы: полигоны могут выходить за базовый crop-квадрат,
        // и тогда дополнительные фрагменты не будут преждевременно обрезаны.
        const sourceToTokenScale = innerSize / Math.max(1, sw);
        const destX = offset - (sx * sourceToTokenScale);
        const destY = offset - (sy * sourceToTokenScale);
        const destW = imgWidth * sourceToTokenScale;
        const destH = imgHeight * sourceToTokenScale;
        ctx.drawImage(img, destX, destY, destW, destH);

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

        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = TOKEN_SIZE;
        maskCanvas.height = TOKEN_SIZE;
        const maskCtx = maskCanvas.getContext("2d");

        maskCtx.clearRect(0, 0, TOKEN_SIZE, TOKEN_SIZE);
        maskCtx.fillStyle = "#ffffff";

        // 1) Базовый круг токена
        maskCtx.beginPath();
        maskCtx.arc(TOKEN_SIZE / 2, TOKEN_SIZE / 2, innerRadius, 0, Math.PI * 2);
        maskCtx.closePath();
        maskCtx.fill();

        // 2) Дополнительные операции по альфе (add/subtract)
        if (validOperations.length > 0) {
            for (const entry of validOperations) {
                maskCtx.save();
                maskCtx.globalCompositeOperation = entry.operation === "subtract" ? "destination-out" : "source-over";
                maskCtx.fillStyle = "#ffffff";
                maskCtx.beginPath();
                traceSmoothClosedPolygon(maskCtx, entry.points, (point) => ({
                    x: offset + ((point.x - sx) * sourceToTokenScale),
                    y: offset + ((point.y - sy) * sourceToTokenScale)
                }));
                maskCtx.fill();
                maskCtx.restore();
            }
        }

        ctx.save();
        ctx.globalCompositeOperation = "destination-in";
        ctx.drawImage(maskCanvas, 0, 0);
        ctx.restore();

        return canvas;
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
