import { TOKEN_FLAG_KEYS } from "../constants.mjs";
import { getTokenFlag, setTokenFlag } from "../utils/flag-utils.mjs";

export async function applyDynamicRing({ tokenDocument, ringConfig }) {
  if (!tokenDocument) return;

  const originalRing = getTokenFlag(tokenDocument, TOKEN_FLAG_KEYS.ORIGINAL_RING);
  if (!originalRing) {
    await setTokenFlag(tokenDocument, TOKEN_FLAG_KEYS.ORIGINAL_RING, foundry.utils.deepClone(tokenDocument.ring ?? {}));
  }

  await tokenDocument.update({ ring: ringConfig });
}

export async function restoreDynamicRing(tokenDocument) {
  if (!tokenDocument) return;

  const originalRing = getTokenFlag(tokenDocument, TOKEN_FLAG_KEYS.ORIGINAL_RING);
  if (!originalRing) return;

  await tokenDocument.update({ ring: originalRing });
}
