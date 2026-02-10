import { IMAGE_LIMIT, IMAGE_TYPES } from "../constants.mjs";
import { ensureActorDirectory, validateImagePath } from "../utils/file-utils.mjs";

export function canAcceptMore(images = []) {
  return images.length < IMAGE_LIMIT;
}

export async function handleExternalDrop({ actor, imageType, imageList, filePath }) {
  if (!canAcceptMore(imageList) || !validateImagePath(filePath)) return null;

  const targetDirectory = await ensureActorDirectory(actor);
  const filename = filePath.split("/").pop();

  return {
    imageType: imageType ?? IMAGE_TYPES.TOKEN,
    targetDirectory,
    filename,
    source: filePath
  };
}
