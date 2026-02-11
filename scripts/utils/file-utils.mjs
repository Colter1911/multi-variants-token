import { MODULE_ID } from "../constants.mjs";

const ALLOWED_EXTENSIONS = new Set(["webp", "png", "jpg", "jpeg", "gif", "svg", "avif"]);

export function sanitizeActorFolder(actor) {
  return actor?.name?.slugify({ strict: true }) || actor?.id || "unknown-actor";
}

export function validateImagePath(path) {
  const extension = path.split(".").pop()?.toLowerCase();
  return ALLOWED_EXTENSIONS.has(extension ?? "");
}

export async function ensureActorDirectory(actor) {
  const target = `multi-tokenart/${sanitizeActorFolder(actor)}`;

  try {
    await FilePicker.createDirectory("data", "multi-tokenart");
  } catch (_error) {
    // Directory can already exist.
  }

  try {
    await FilePicker.createDirectory("data", target);
  } catch (_error) {
    // Directory can already exist.
  }

  return target;
}

export async function uploadFileToActorFolder(file, actor) {
  const folder = await ensureActorDirectory(actor);
  try {
    const result = await FilePicker.upload("data", folder, file);
    return result.path;
  } catch (error) {
    ui.notifications.error(`Upload failed: ${error.message}`);
    return null;
  }
}
