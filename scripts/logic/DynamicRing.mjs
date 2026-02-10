import { TOKEN_FLAG_KEYS } from "../constants.mjs";
import { getTokenFlag, setTokenFlag } from "../utils/flag-utils.mjs";
import { MODULE_ID } from "../constants.mjs";

export async function applyDynamicRing({ tokenDocument, ringConfig }) {
  if (!tokenDocument) return;

  const originalRing = getTokenFlag(tokenDocument, TOKEN_FLAG_KEYS.ORIGINAL_RING);
  if (!originalRing) {
    await setTokenFlag(tokenDocument, TOKEN_FLAG_KEYS.ORIGINAL_RING, foundry.utils.deepClone(tokenDocument.ring ?? {}));
  }

  await tokenDocument.update({ ring: ringConfig });
  const state = tokenDocument.getFlag(MODULE_ID, "state") ?? {};

  if (!state.originalRing) {
    state.originalRing = foundry.utils.deepClone(tokenDocument.ring ?? {});
  }

  await tokenDocument.update({ ring: ringConfig });
  await tokenDocument.setFlag(MODULE_ID, "state", state);
}

export async function restoreDynamicRing(tokenDocument) {
  if (!tokenDocument) return;

  const originalRing = getTokenFlag(tokenDocument, TOKEN_FLAG_KEYS.ORIGINAL_RING);
  if (!originalRing) return;

  await tokenDocument.update({ ring: originalRing });
  const state = tokenDocument.getFlag(MODULE_ID, "state") ?? {};
  if (!state.originalRing) return;

  await tokenDocument.update({ ring: state.originalRing });
}
