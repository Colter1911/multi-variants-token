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
