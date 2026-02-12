import { TOKEN_FLAG_KEYS } from "../constants.mjs";
import { getTokenFlag, setTokenFlag } from "../utils/flag-utils.mjs";

export async function applyAutoRotate({ tokenDocument, shouldRotate }) {
  if (!tokenDocument) return;

  // Get current rotation directly from data to be sure
  const currentRotation = tokenDocument.rotation ?? 0;

  let originalRotation = getTokenFlag(tokenDocument, TOKEN_FLAG_KEYS.ORIGINAL_ROTATION);

  // If original is missing, initialize it
  if (originalRotation === null || originalRotation === undefined) {
    // If we are about to rotate DOWN (shouldRotate=true) and we are NOT already at 270, assume current is original
    // If we are already at 270, we might be in a bad state where we forgot original. Default to 0.
    if (shouldRotate && currentRotation === 270) {
      originalRotation = 0;
    } else {
      originalRotation = currentRotation;
    }
    await setTokenFlag(tokenDocument, TOKEN_FLAG_KEYS.ORIGINAL_ROTATION, originalRotation);
  }

  const updates = {};
  /*
  console.log("[MTA] applyAutoRotate", { 
    name: tokenDocument.name, 
    shouldRotate, 
    current: currentRotation, 
    original: originalRotation 
  });
  */

  if (shouldRotate) {
    if (currentRotation !== 270) {
      updates.rotation = 270;
    }
  } else {
    // Restore
    if (currentRotation !== originalRotation) {
      updates.rotation = originalRotation;
    }
  }

  if (foundry.utils.isEmpty(updates)) return;

  await tokenDocument.update(updates);
}
