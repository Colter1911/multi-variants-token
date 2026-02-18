import { MODULE_ID } from "../constants.mjs";

const ALLOWED_EXTENSIONS = new Set(["webp", "png", "jpg", "jpeg", "gif", "svg", "avif"]);
const ROOT_DIRECTORY = "multi-tokenart";
const MODULE_SOCKET = `module.${MODULE_ID}`;
const SOCKET_TIMEOUT_MS = 8000;
const SOCKET_TYPES = {
  ENSURE_DIRECTORY_REQUEST: "ensure-directory-request",
  ENSURE_DIRECTORY_RESPONSE: "ensure-directory-response"
};

let socketHandlersRegistered = false;
const pendingSocketRequests = new Map();

export function sanitizeActorFolder(actor) {
  return actor?.name?.slugify({ strict: true }) || actor?.id || "unknown-actor";
}

export function validateImagePath(path) {
  const extension = path.split(".").pop()?.toLowerCase();
  return ALLOWED_EXTENSIONS.has(extension ?? "");
}

function isDirectoryExistsError(error) {
  const message = `${error?.message ?? error ?? ""}`.toLowerCase();
  return message.includes("already exists") || message.includes("eexist");
}

function buildActorDirectoryTarget(actor) {
  return `${ROOT_DIRECTORY}/${sanitizeActorFolder(actor)}`;
}

function notifyDirectoryError(error) {
  const details = error?.message ?? String(error);
  const message = game.i18n.format("MTA.DirectoryCreateError", { error: details });
  ui.notifications.error(message);
}

async function createDirectoryIfMissing(target) {
  try {
    await FilePicker.createDirectory("data", target);
  } catch (error) {
    if (isDirectoryExistsError(error)) return;
    throw error;
  }
}

async function ensureDirectoryLocal(target) {
  await createDirectoryIfMissing(ROOT_DIRECTORY);
  await createDirectoryIfMissing(target);
  return target;
}

function onModuleSocketMessage(payload) {
  if (!payload?.type) return;

  if (payload.type === SOCKET_TYPES.ENSURE_DIRECTORY_REQUEST) {
    void handleEnsureDirectoryRequest(payload);
    return;
  }

  if (payload.type !== SOCKET_TYPES.ENSURE_DIRECTORY_RESPONSE) return;
  if (payload.recipientId !== game.user?.id) return;

  const pending = pendingSocketRequests.get(payload.requestId);
  if (!pending) return;

  clearTimeout(pending.timeoutId);
  pendingSocketRequests.delete(payload.requestId);

  if (payload.ok) {
    pending.resolve(payload.target);
  } else {
    pending.reject(new Error(payload.error ?? game.i18n.localize("MTA.DirectoryCreateTimeout")));
  }
}

async function handleEnsureDirectoryRequest(payload) {
  if (!game.user?.isGM) return;
  if (game.users?.activeGM?.id !== game.user.id) return;

  const { requestId, requesterId, target } = payload;
  if (!requestId || !requesterId || !target) return;

  try {
    await ensureDirectoryLocal(target);
    game.socket.emit(MODULE_SOCKET, {
      type: SOCKET_TYPES.ENSURE_DIRECTORY_RESPONSE,
      requestId,
      recipientId: requesterId,
      target,
      ok: true
    });
  } catch (error) {
    game.socket.emit(MODULE_SOCKET, {
      type: SOCKET_TYPES.ENSURE_DIRECTORY_RESPONSE,
      requestId,
      recipientId: requesterId,
      target,
      ok: false,
      error: error?.message ?? String(error)
    });
  }
}

async function requestEnsureDirectoryFromGm(target) {
  const requestId = foundry.utils.randomID();

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingSocketRequests.delete(requestId);
      reject(new Error(game.i18n.localize("MTA.DirectoryCreateTimeout")));
    }, SOCKET_TIMEOUT_MS);

    pendingSocketRequests.set(requestId, { resolve, reject, timeoutId });

    game.socket.emit(MODULE_SOCKET, {
      type: SOCKET_TYPES.ENSURE_DIRECTORY_REQUEST,
      requestId,
      requesterId: game.user?.id,
      target
    });
  });
}

export function registerFileSocketHandlers() {
  if (socketHandlersRegistered) return;
  if (!game.socket) return;

  game.socket.on(MODULE_SOCKET, onModuleSocketMessage);
  socketHandlersRegistered = true;
}

export async function ensureActorDirectory(actor) {
  const target = buildActorDirectoryTarget(actor);

  try {
    await ensureDirectoryLocal(target);
    return target;
  } catch (localError) {
    if (game.user?.isGM) {
      notifyDirectoryError(localError);
      return target;
    }

    if (!socketHandlersRegistered) registerFileSocketHandlers();

    if (!game.users?.activeGM) {
      notifyDirectoryError(new Error(game.i18n.localize("MTA.DirectoryCreateNoActiveGM")));
      return target;
    }

    try {
      await requestEnsureDirectoryFromGm(target);
      return target;
    } catch (remoteError) {
      notifyDirectoryError(remoteError);
      return target;
    }
  }
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
