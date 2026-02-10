import { TOKEN_FLAG_KEYS } from "../constants.mjs";
import { getTokenFlag, setTokenFlag } from "../utils/flag-utils.mjs";

export async function applyAutoRotate({ tokenDocument, shouldRotate }) {
  if (!tokenDocument) return;

  const currentOriginal = getTokenFlag(tokenDocument, TOKEN_FLAG_KEYS.ORIGINAL_ROTATION);
  const originalRotation = Number(currentOriginal ?? tokenDocument.rotation ?? 0);

  if (currentOriginal === null || currentOriginal === undefined) {
    await setTokenFlag(tokenDocument, TOKEN_FLAG_KEYS.ORIGINAL_ROTATION, originalRotation);
  }

  const rotation = shouldRotate ? (originalRotation + 270) % 360 : originalRotation;
  await tokenDocument.update({ rotation });
}
