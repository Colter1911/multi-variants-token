import { MODULE_ID, TOKEN_FLAG_KEYS } from "../constants.mjs";
import { getTokenFlag } from "../utils/flag-utils.mjs";

/**
 * Calculates the update payload to ENABLE the dynamic ring.
 * Checks if we need to save the original ring state first.
 * Does NOT perform the update itself.
 * 
 * @param {TokenDocument} tokenDocument 
 * @param {Object} ringConfig 
 * @returns {Object} The update object to be merged into tokenDocument.update()
 */
export function getDynamicRingUpdate(tokenDocument, ringConfig) {
  if (!tokenDocument) return {};

  const updates = {};
  const currentFlags = tokenDocument.flags?.[MODULE_ID] ?? {};

  // Check if we need to snapshot the original state
  // We use the flags object directly to avoid async getTokenFlag overhead if possible, 
  // but getTokenFlag is safer if flags structure is complex.
  const originalRing = currentFlags[TOKEN_FLAG_KEYS.ORIGINAL_RING];

  if (!originalRing) {
    const currentRing = foundry.utils.deepClone(tokenDocument.ring ?? {});
    // If original was empty or undefined, ensure we store a state that explicitly disables it upon restore
    if (foundry.utils.isEmpty(currentRing) || currentRing.enabled === undefined) {
      currentRing.enabled = false;
    }
    updates[`flags.${MODULE_ID}.${TOKEN_FLAG_KEYS.ORIGINAL_RING}`] = currentRing;
  }

  // Ring Config
  updates.ring = {
    enabled: ringConfig.enabled,
    colors: {
      ring: ringConfig.ringColor,
      background: ringConfig.backgroundColor
    },
    subject: {
      scale: ringConfig.scaleCorrection,
      texture: ringConfig.texture || null // Explicitly use configured texture or CLEAR it to use token image
    }
  };

  return updates;
}

/**
 * Calculates the update payload to RESTORE the original ring state.
 * Does NOT perform the update itself.
 * 
 * @param {TokenDocument} tokenDocument 
 * @returns {Object} The update object to be merged into tokenDocument.update()
 */
export function getRestoreRingUpdate(tokenDocument) {
  if (!tokenDocument) return {};

  const originalRing = getTokenFlag(tokenDocument, TOKEN_FLAG_KEYS.ORIGINAL_RING);
  if (!originalRing) return {}; // Nothing to restore

  const updates = {};

  // Create a safe copy to restore
  const restoreData = foundry.utils.deepClone(originalRing);

  // CRITICAL FIX: Ensure we do NOT restore a specific texture path for the ring subject.
  // This prevents "stuck" images if the original ring state captured an old image path.
  // We must set it to NULL to explicitly clear any existing value during the merge.
  if (!restoreData.subject) restoreData.subject = {};
  restoreData.subject.texture = null;

  updates.ring = restoreData;

  // Clean up the flag so the next activation takes a fresh snapshot
  updates[`flags.${MODULE_ID}.-=${TOKEN_FLAG_KEYS.ORIGINAL_RING}`] = null;

  return updates;
}

// Keep old functions for backward compatibility or if called elsewhere (though we should migrate all)
// They now just wrap the new logic.
export async function applyDynamicRing({ tokenDocument, ringConfig }) {
  const updates = getDynamicRingUpdate(tokenDocument, ringConfig);
  if (!foundry.utils.isEmpty(updates)) {
    await tokenDocument.update(updates, { mtaManualUpdate: true });
  }
}

export async function restoreDynamicRing(tokenDocument) {
  const updates = getRestoreRingUpdate(tokenDocument);
  if (!foundry.utils.isEmpty(updates)) {
    await tokenDocument.update(updates, { mtaManualUpdate: true });
  }
}
