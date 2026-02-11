import { TOKEN_FLAG_KEYS } from "../constants.mjs";
import { getTokenFlag, setTokenFlag } from "../utils/flag-utils.mjs";

export async function applyAutoRotate({ tokenDocument, shouldRotate }) {
  if (!tokenDocument) return;

  // Получаем текущий rotation
  const currentRotation = tokenDocument.rotation ?? 0;

  // Получаем сохраненный оригинальный rotation
  let originalRotation = getTokenFlag(tokenDocument, TOKEN_FLAG_KEYS.ORIGINAL_ROTATION);

  // Если оригинал не сохранен и мы первый раз применяем rotation
  if (originalRotation === null || originalRotation === undefined) {
    originalRotation = currentRotation;
    await setTokenFlag(tokenDocument, TOKEN_FLAG_KEYS.ORIGINAL_ROTATION, originalRotation);
  }

  const updates = {};

  console.log("[Multi Token Art] applyAutoRotate", {
    tokenName: tokenDocument.name,
    shouldRotate,
    currentRotation,
    originalRotation
  });

  if (shouldRotate) {
    // Rotate to 270 degrees (lying on side)
    if (currentRotation !== 270) {
      updates.rotation = 270;
    }
  } else {
    // Restore original rotation
    if (currentRotation !== originalRotation) {
      updates.rotation = originalRotation;
    }
  }

  if (Object.keys(updates).length > 0) {
    console.log("[Multi Token Art] Applying rotation update", updates);
    await tokenDocument.update(updates);
  }
}
