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
        let cropSize = faceHeight * scaleFactor;

        // 1. Cap crop size to the smallest dimension of the image
        const maxPossibleSize = Math.min(imgWidth, imgHeight);
        if (cropSize > maxPossibleSize) {
            console.warn(`[MTA AutoToken] Requested crop size ${cropSize} exceeds image bounds. Clamped to ${maxPossibleSize}.`);
            cropSize = maxPossibleSize;
        }

        const halfCrop = cropSize / 2;

        // 2. Calculate initial top-left corner
        let sx = faceCenterX - halfCrop;
        let sy = faceCenterY - halfCrop;

        // 3. Shift/Clamp to keep within image boundaries
        // Only shift origin, do NOT resize crop (preserves Aspect Ratio)
        if (sx < 0) sx = 0;
        if (sx + cropSize > imgWidth) sx = imgWidth - cropSize;

        if (sy < 0) sy = 0;
        if (sy + cropSize > imgHeight) sy = imgHeight - cropSize;

        // Final Integer Rounding
        // Use floor for origin, ceil for size? No, keep it simple.
        let sw = Math.floor(cropSize);
        let sh = Math.floor(cropSize);
        sx = Math.floor(sx);
        sy = Math.floor(sy);

        console.log(`[MTA AutoToken] Final Draw Coords: sx=${sx}, sy=${sy}, size=${sw}x${sh} from ${imgWidth}x${imgHeight}`);

        // Aspect Ratio Safe Clamp
        // If despite all logic, we are still 1px out (rounding),
        // we must shrink BOTH width and height to keep square.
        if (sx + sw > imgWidth) {
            const diff = (sx + sw) - imgWidth;
            sw -= diff;
            sh -= diff; // Keep square!
        }
        if (sy + sh > imgHeight) {
            const diff = (sy + sh) - imgHeight;
            sw -= diff;
            sh -= diff; // Keep square!
        }

        // Double check < 0
        if (sw < 1) sw = 1;
        if (sh < 1) sh = 1;

        console.log(`[MTA AutoToken] Final Draw Coords: sx=${sx}, sy=${sy}, size=${sw}x${sh} from ${imgWidth}x${imgHeight}`);
        try {
            // --- Шаг Г: Композитинг (Intermediate Canvas Method) ---
            // Create a canvas exactly the size of the crop
            const cropCanvas = document.createElement("canvas");
            cropCanvas.width = sw;
            cropCanvas.height = sh;
            const cropCtx = cropCanvas.getContext("2d");

            // Draw the image shifted by -sx, -sy.
            // Any pixels outside [0, 0, imgWidth, imgHeight] are essentially "transparent void" in the source,
            // so drawing them results in transparency on the cropCanvas.
            cropCtx.drawImage(img, -sx, -sy);


            // --- Final Token Canvas ---
            const canvas = document.createElement("canvas");
            canvas.width = TOKEN_SIZE;
            canvas.height = TOKEN_SIZE;
            const ctx = canvas.getContext("2d");

            // Очистка (по умолчанию прозрачный)
            ctx.clearRect(0, 0, TOKEN_SIZE, TOKEN_SIZE);

            // Масштаб 0.85 — чтобы круг вписывался внутрь Dynamic Ring
            const INNER_SCALE = 0.85;
            const innerSize = TOKEN_SIZE * INNER_SCALE;
            const innerRadius = innerSize / 2;
            const offset = (TOKEN_SIZE - innerSize) / 2;

            // Создание круглого клиппинга для токена
            ctx.save();
            ctx.beginPath();
            ctx.arc(TOKEN_SIZE / 2, TOKEN_SIZE / 2, innerRadius, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();

            // Рисуем подготовленный cropCanvas, растягивая его на innerSize
            ctx.drawImage(cropCanvas, 0, 0, sw, sh, offset, offset, innerSize, innerSize);
            ctx.restore();

            // --- Шаг Д: Вывод ---
            const blob = await new Promise((resolve) => {
                canvas.toBlob((b) => resolve(b), "image/webp", 0.85);
            });

            if (!blob) {
                throw new Error("Canvas toBlob failed (empty or corrupt image data).");
            }

            return { blob, faceCoordinates };
        } catch (err) {
            console.error("[MTA AutoToken] Error generating token blob:", err);
            throw err;
        }

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
