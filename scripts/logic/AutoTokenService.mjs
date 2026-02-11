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

        // --- Шаг Б: Детекция лица ---
        const detection = await faceapi.detectSingleFace(
            img,
            new faceapi.TinyFaceDetectorOptions({
                inputSize: 512,
                scoreThreshold: 0.5
            })
        );

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
            faceCenterX = img.width / 2;
            faceCenterY = img.height / 2;
            faceHeight = img.height * 0.5;
            console.log("[MTA AutoToken] Лицо не обнаружено, используется центр изображения как фоллбэк.");
        }

        // --- Шаг В: Вычисление геометрии (Safe Crop) ---
        let cropSize = faceHeight * scaleFactor;

        // Расстояние от центра лица до краев изображения
        const distLeft = faceCenterX;
        const distRight = img.width - faceCenterX;
        const distTop = faceCenterY;
        const distBottom = img.height - faceCenterY;

        // Максимально возможный радиус, чтобы круг вписался в границы,
        // сохраняя центр лица в центре круга.
        const maxRadius = Math.min(distLeft, distRight, distTop, distBottom);
        const maxCropSize = maxRadius * 2;

        // Если желаемый размер больше возможного — уменьшаем
        if (cropSize > maxCropSize) {
            console.warn(`[MTA AutoToken] Crop size reduced to fit bounds: ${cropSize} -> ${maxCropSize}`);
            cropSize = maxCropSize;
        }

        const halfCrop = cropSize / 2;

        // Source rect — квадрат вокруг лица (гарантированно внутри картинки)
        let sx = Math.floor(faceCenterX - halfCrop);
        let sy = Math.floor(faceCenterY - halfCrop);
        let sw = Math.floor(cropSize);
        let sh = Math.floor(cropSize);

        // --- Шаг Г: Композитинг ---
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

        // Создание круглого клиппинга (уменьшенного)
        ctx.save();
        ctx.beginPath();
        ctx.arc(TOKEN_SIZE / 2, TOKEN_SIZE / 2, innerRadius, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();

        // Рисуем изображение внутри уменьшенного круга
        ctx.drawImage(img, sx, sy, sw, sh, offset, offset, innerSize, innerSize);
        ctx.restore();

        // --- Шаг Д: Вывод ---
        const blob = await new Promise((resolve) => {
            canvas.toBlob((b) => resolve(b), "image/webp", 0.85);
        });

        if (!blob) {
            throw new Error("Canvas toBlob failed (empty or corrupt image data).");
        }

        return { blob, faceCoordinates };
    }

    /**
     * Загружает изображение с поддержкой CORS.
     * @param {string|HTMLImageElement} source
     * @returns {Promise<HTMLImageElement>}
     * @private
     */
    _loadImage(source) {
        if (source instanceof HTMLImageElement && source.complete) {
            return Promise.resolve(source);
        }

        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => resolve(img);
            img.onerror = (err) => reject(new Error(`[MTA AutoToken] Не удалось загрузить изображение: ${source}`));
            img.src = typeof source === "string" ? source : source.src;
        });
    }
}
