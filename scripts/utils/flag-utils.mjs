import { MODULE_ID, TOKEN_FLAG_KEYS } from "../constants.mjs";
import { ModuleData } from "../data/ModuleData.mjs";
import { MODULE_ID } from "../constants.mjs";

const DEFAULT_MODULE_DATA = {
  version: 1,
  global: {
    autoRotate: true,
    tokenRandom: false,
    portraitRandom: false
  },
  tokenImages: [],
  portraitImages: []
};

export function getActorModuleData(actor) {
  const raw = foundry.utils.getProperty(actor, `flags.${MODULE_ID}`) ?? {};

  try {
    return new ModuleData(raw).toObject();
  } catch (_error) {
    const fallback = foundry.utils.mergeObject(foundry.utils.deepClone(DEFAULT_MODULE_DATA), raw, {
      inplace: false,
      performDeletions: false
    });

    return new ModuleData(fallback).toObject();
  }
}

export async function setActorModuleData(actor, data) {
  const normalized = new ModuleData(data).toObject();
  return actor.update({ [`flags.${MODULE_ID}`]: normalized });
}

export async function setTokenFlag(tokenDocument, key, value) {
  return tokenDocument.setFlag(MODULE_ID, key, value);
}

export function getTokenFlag(tokenDocument, key, fallback = null) {
  return tokenDocument.getFlag(MODULE_ID, key) ?? fallback;
}

export function getTokenOriginalState(tokenDocument) {
  return {
    originalRing: getTokenFlag(tokenDocument, TOKEN_FLAG_KEYS.ORIGINAL_RING),
    originalRotation: getTokenFlag(tokenDocument, TOKEN_FLAG_KEYS.ORIGINAL_ROTATION)
  };
  const raw = actor?.getFlag(MODULE_ID, MODULE_ID) ?? actor?.getFlag(MODULE_ID, "") ?? actor?.flags?.[MODULE_ID] ?? {};

  return foundry.utils.mergeObject(foundry.utils.deepClone(DEFAULT_MODULE_DATA), raw ?? {}, {
    performDeletions: false,
    inplace: false
  });
}

export async function setActorModuleData(actor, data) {
  return actor.setFlag(MODULE_ID, MODULE_ID, data);
}

export async function updateTokenFlags(tokenDocument, updates) {
  return tokenDocument.setFlag(MODULE_ID, "state", {
    ...(tokenDocument.getFlag(MODULE_ID, "state") ?? {}),
    ...updates
  });
}
