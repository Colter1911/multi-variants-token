import { MODULE_ID, TOKEN_FLAG_KEYS } from "../constants.mjs";
import { ModuleData } from "../data/ModuleData.mjs";

const DEFAULT_MODULE_DATA = {
  version: 1,
  global: {
    autoRotate: false,
    tokenRandom: false,
    portraitRandom: false,
    linkTokenPortrait: false
  },
  tokenImages: [],
  portraitImages: []
};

const HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function asPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return fallback;
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toInteger(value, fallback = 0) {
  return Math.trunc(toNumber(value, fallback));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sanitizeColor(value, fallback) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return HEX_COLOR_REGEX.test(normalized) ? normalized : fallback;
}

function sanitizeManualToken(rawManualToken) {
  const manualToken = asPlainObject(rawManualToken);
  const source = asPlainObject(manualToken.source);
  const selection = asPlainObject(manualToken.selection);

  const sourceSrc = typeof source.src === "string" ? source.src.trim() : "";
  const naturalWidth = toNumber(source.naturalWidth, 0);
  const naturalHeight = toNumber(source.naturalHeight, 0);
  const centerX = toNumber(selection.centerX, NaN);
  const centerY = toNumber(selection.centerY, NaN);
  const cropSize = toNumber(selection.cropSize, NaN);

  if (!sourceSrc || naturalWidth <= 0 || naturalHeight <= 0) return null;
  if (!Number.isFinite(centerX) || !Number.isFinite(centerY) || !Number.isFinite(cropSize) || cropSize <= 0) return null;

  const sanitizePoint = (point) => {
    const sourcePoint = asPlainObject(point);
    const x = toNumber(sourcePoint.x, NaN);
    const y = toNumber(sourcePoint.y, NaN);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  };

  const alphaPolygons = Array.isArray(manualToken.alphaPolygons)
    ? manualToken.alphaPolygons
        .map((entry) => {
          const polygon = asPlainObject(entry);
          const points = Array.isArray(polygon.points) ? polygon.points.map(sanitizePoint).filter(Boolean) : [];
          if (points.length < 3) return null;
          return {
            operation: polygon.operation === "subtract" ? "subtract" : "add",
            points
          };
        })
        .filter(Boolean)
    : [];

  const stageView = asPlainObject(manualToken.stageView);
  const customFrame = asPlainObject(manualToken.customFrame);
  const render = asPlainObject(manualToken.render);
  const customFrameEnabled = toBoolean(customFrame.enabled, false);
  const frameSrc = typeof customFrame.src === "string" ? customFrame.src.trim() : "";

  return {
    version: Math.max(1, toInteger(manualToken.version, 1)),
    source: {
      src: sourceSrc,
      originalSrc: typeof source.originalSrc === "string" ? source.originalSrc.trim() : "",
      imageType: source.imageType === "portrait" ? "portrait" : "token",
      imageId: typeof source.imageId === "string" && source.imageId.trim() ? source.imageId.trim() : null,
      naturalWidth,
      naturalHeight
    },
    selection: {
      centerX,
      centerY,
      cropSize
    },
    alphaPolygons,
    previewZoom: clamp(toNumber(manualToken.previewZoom, 1), 0.05, 100),
    stageView: {
      zoom: clamp(toNumber(stageView.zoom, 1), 0.05, 100),
      panX: toNumber(stageView.panX, 0),
      panY: toNumber(stageView.panY, 0)
    },
    customFrame: {
      enabled: customFrameEnabled && !!frameSrc,
      src: frameSrc,
      originalSrc: typeof customFrame.originalSrc === "string" ? customFrame.originalSrc.trim() : "",
      removeWhiteBg: toBoolean(customFrame.removeWhiteBg, false),
      offsetX: toNumber(customFrame.offsetX, 0),
      offsetY: toNumber(customFrame.offsetY, 0),
      scale: clamp(toNumber(customFrame.scale, 1), 0.05, 100)
    },
    render: {
      customFrameEnabled: toBoolean(render.customFrameEnabled, customFrameEnabled && !!frameSrc),
      textureScale: clamp(toNumber(render.textureScale, 1), 0.05, 100),
      canvasSize: render.canvasSize === null || render.canvasSize === undefined ? null : Math.max(1, toInteger(render.canvasSize, 512)),
      compositionScale: clamp(toNumber(render.compositionScale, 1), 0.05, 100),
      allowOverflowCanvas: toBoolean(render.allowOverflowCanvas, true),
      centerOverflowCanvas: toBoolean(render.centerOverflowCanvas, true),
      maskMode: render.maskMode === "base" || render.maskMode === "additions" ? render.maskMode : "full"
    }
  };
}

function sanitizeImageList(rawList, { allowManualToken = false } = {}) {
  if (!Array.isArray(rawList)) return [];

  const indexedList = rawList
    .map((entry, index) => {
      const image = asPlainObject(entry);
      return {
        image,
        index,
        sort: toInteger(image.sort, index)
      };
    })
    .sort((a, b) => {
      const sortDiff = a.sort - b.sort;
      return sortDiff !== 0 ? sortDiff : a.index - b.index;
    });

  const usedIds = new Set();
  const result = [];

  for (const { image } of indexedList) {
    const src = typeof image.src === "string" ? image.src.trim() : "";
    if (!src) continue;

    let id = typeof image.id === "string" ? image.id.trim() : "";
    if (!id) {
      id = `mta-image-${result.length}`;
    }
    if (usedIds.has(id)) {
      let suffix = 1;
      while (usedIds.has(`${id}-${suffix}`)) {
        suffix += 1;
      }
      id = `${id}-${suffix}`;
    }
    usedIds.add(id);

    const autoEnable = asPlainObject(image.autoEnable);
    const dynamicRing = asPlainObject(image.dynamicRing);

    const sanitizedImage = {
      id,
      src,
      scaleX: toNumber(image.scaleX, 1),
      scaleY: toNumber(image.scaleY, 1),
      sort: result.length,
      isDefault: toBoolean(image.isDefault, false),
      autoEnable: {
        enabled: toBoolean(autoEnable.enabled, false),
        wounded: toBoolean(autoEnable.wounded, false),
        woundedPercent: clamp(toInteger(autoEnable.woundedPercent, 50), 1, 99),
        die: toBoolean(autoEnable.die, false),
        status: typeof autoEnable.status === "string" ? autoEnable.status.trim() : ""
      },
      customScript: typeof image.customScript === "string" ? image.customScript : "",
      dynamicRing: {
        enabled: toBoolean(dynamicRing.enabled, false),
        scaleCorrection: toNumber(dynamicRing.scaleCorrection, 1),
        ringColor: sanitizeColor(dynamicRing.ringColor, "#ffffff"),
        backgroundColor: sanitizeColor(dynamicRing.backgroundColor, "#000000"),
        texture: typeof dynamicRing.texture === "string" && dynamicRing.texture.trim() ? dynamicRing.texture.trim() : null,
        subjectScaleCorrection: clamp(toNumber(dynamicRing.subjectScaleCorrection, 1), 0.05, 100)
      }
    };

    if (allowManualToken) {
      const manualToken = sanitizeManualToken(image.manualToken);
      if (manualToken) sanitizedImage.manualToken = manualToken;
    }

    result.push(sanitizedImage);
  }

  if (result.length > 0) {
    let defaultSet = false;
    for (const image of result) {
      if (image.isDefault && !defaultSet) {
        defaultSet = true;
        continue;
      }
      if (image.isDefault && defaultSet) {
        image.isDefault = false;
      }
    }

    if (!defaultSet) {
      result[0].isDefault = true;
    }
  }

  return result;
}

function sanitizeModuleData(rawData) {
  const source = asPlainObject(rawData);
  const global = asPlainObject(source.global);

  return {
    version: Math.max(1, toInteger(source.version, DEFAULT_MODULE_DATA.version)),
    global: {
      autoRotate: toBoolean(global.autoRotate, DEFAULT_MODULE_DATA.global.autoRotate),
      tokenRandom: toBoolean(global.tokenRandom, DEFAULT_MODULE_DATA.global.tokenRandom),
      portraitRandom: toBoolean(global.portraitRandom, DEFAULT_MODULE_DATA.global.portraitRandom),
      linkTokenPortrait: toBoolean(global.linkTokenPortrait, DEFAULT_MODULE_DATA.global.linkTokenPortrait)
    },
    tokenImages: sanitizeImageList(source.tokenImages, { allowManualToken: true }),
    portraitImages: sanitizeImageList(source.portraitImages)
  };
}



export function actorHasModuleFlags(actor) {
  const raw = foundry.utils.getProperty(actor, `flags.${MODULE_ID}`);
  return !!(raw && typeof raw === "object");
}

export function getActorModuleData(actor) {
  if (!actor) {
    return foundry.utils.deepClone(DEFAULT_MODULE_DATA);
  }

  const raw = foundry.utils.getProperty(actor, `flags.${MODULE_ID}`);
  const sanitized = sanitizeModuleData(raw);

  try {
    return new ModuleData(sanitized).toObject();
  } catch (error) {
    console.warn("[MTA] Failed to parse actor flags, returning safe defaults", {
      actorId: actor?.id,
      actorName: actor?.name,
      error
    });
    return foundry.utils.deepClone(DEFAULT_MODULE_DATA);
  }
}

export async function setActorModuleData(actor, data) {
  if (!actor) return null;

  const sanitized = sanitizeModuleData(data);
  let normalized;

  try {
    normalized = new ModuleData(sanitized).toObject();
  } catch (error) {
    console.error("[MTA] Failed to normalize actor flags before save, writing defaults", {
      actorId: actor?.id,
      actorName: actor?.name,
      error
    });
    normalized = foundry.utils.deepClone(DEFAULT_MODULE_DATA);
  }

  try {
    return await actor.update({ [`flags.${MODULE_ID}`]: normalized });
  } catch (error) {
    console.error("[MTA] Failed to write actor flags", {
      actorId: actor?.id,
      actorName: actor?.name,
      error
    });
    return null;
  }
}

export async function setTokenFlag(tokenDocument, key, value) {
  return tokenDocument.setFlag(MODULE_ID, key, value);
}

export function getTokenFlag(tokenDocument, key, fallback = null) {
  if (!tokenDocument) {
    console.warn("[MTA] getTokenFlag: tokenDocument is null/undefined");
    return fallback;
  }

  if (typeof tokenDocument.getFlag !== 'function') {
    console.error("[MTA] getTokenFlag: tokenDocument.getFlag is not a function", {
      tokenDocument,
      type: typeof tokenDocument,
      constructor: tokenDocument?.constructor?.name
    });
    return fallback;
  }

  return tokenDocument.getFlag(MODULE_ID, key) ?? fallback;
}

export function getTokenOriginalState(tokenDocument) {
  return {
    originalRing: getTokenFlag(tokenDocument, TOKEN_FLAG_KEYS.ORIGINAL_RING),
    originalRotation: getTokenFlag(tokenDocument, TOKEN_FLAG_KEYS.ORIGINAL_ROTATION)
  };
}
