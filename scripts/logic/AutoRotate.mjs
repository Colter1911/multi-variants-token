import { MODULE_ID } from "../constants.mjs";

export async function applyAutoRotate({ tokenDocument, shouldRotate }) {
  if (!tokenDocument) return;

  const state = tokenDocument.getFlag(MODULE_ID, "state") ?? {};
  if (state.originalRotation === undefined) {
    state.originalRotation = tokenDocument.rotation ?? 0;
  }

  const rotation = shouldRotate ? (state.originalRotation + 270) % 360 : state.originalRotation;

  await tokenDocument.update({ rotation });
  await tokenDocument.setFlag(MODULE_ID, "state", state);
}
