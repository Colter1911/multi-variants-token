import { TOKEN_FLAG_KEYS } from "../constants.mjs";
import { getTokenFlag, setTokenFlag } from "../utils/flag-utils.mjs";

export async function applyDynamicRing({ tokenDocument, ringConfig }) {
  if (!tokenDocument) return;

  const originalRing = getTokenFlag(tokenDocument, TOKEN_FLAG_KEYS.ORIGINAL_RING);
  if (!originalRing) {
    const current = foundry.utils.deepClone(tokenDocument.ring ?? {});
    // If original was empty or undefined, ensure we store a state that explicitly disables it upon restore
    if (foundry.utils.isEmpty(current) || current.enabled === undefined) {
      current.enabled = false;
    }
    await setTokenFlag(tokenDocument, TOKEN_FLAG_KEYS.ORIGINAL_RING, current);
  }

  const ring = {
    enabled: ringConfig.enabled,
    colors: {
      ring: ringConfig.ringColor,
      background: ringConfig.backgroundColor
    },
    subject: {
      scale: ringConfig.scaleCorrection
    }
  };

  await tokenDocument.update({ ring });
}

export async function restoreDynamicRing(tokenDocument) {
  if (!tokenDocument) return;

  const originalRing = getTokenFlag(tokenDocument, TOKEN_FLAG_KEYS.ORIGINAL_RING);
  if (!originalRing) return;

  await tokenDocument.update({ ring: originalRing });
}
