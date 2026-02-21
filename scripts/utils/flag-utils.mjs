import { MODULE_ID, TOKEN_FLAG_KEYS } from "../constants.mjs";
import { ModuleData } from "../data/ModuleData.mjs";

const DEFAULT_MODULE_DATA = {
  version: 1,
  global: {
    autoRotate: true,
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

function sanitizeImageList(rawList) {
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

    result.push({
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
        backgroundColor: sanitizeColor(dynamicRing.backgroundColor, "#000000")
      }
    });
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
    tokenImages: sanitizeImageList(source.tokenImages),
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
