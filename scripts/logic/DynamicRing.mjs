import { MODULE_ID } from "../constants.mjs";

export async function applyDynamicRing({ tokenDocument, ringConfig }) {
  if (!tokenDocument) return;

  const state = tokenDocument.getFlag(MODULE_ID, "state") ?? {};

  if (!state.originalRing) {
    state.originalRing = foundry.utils.deepClone(tokenDocument.ring ?? {});
  }

  await tokenDocument.update({ ring: ringConfig });
  await tokenDocument.setFlag(MODULE_ID, "state", state);
}

export async function restoreDynamicRing(tokenDocument) {
  if (!tokenDocument) return;
  const state = tokenDocument.getFlag(MODULE_ID, "state") ?? {};
  if (!state.originalRing) return;

  await tokenDocument.update({ ring: state.originalRing });
}
