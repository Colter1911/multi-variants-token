import { MODULE_ID, SETTINGS, TOKEN_FLAG_KEYS } from "./constants.mjs";
import { registerSettings, applySystemPresetIfNeeded } from "./settings.mjs";
import { registerTokenHudButton, openManagerForTokenDocument, openManagerForActor } from "./ui/TokenHUD.mjs";
import { registerFileSocketHandlers } from "./utils/file-utils.mjs";
import { runAutoActivation, applyTokenImageById, applyPortraitById } from "./logic/AutoActivation.mjs";
import { pickRandomImage } from "./logic/RandomMode.mjs";
import { actorHasModuleFlags, getActorModuleData } from "./utils/flag-utils.mjs";

console.log("✅ Multi Token Art | module.mjs loaded");

const ACTOR_SHEET_BUTTON_CLASS = `${MODULE_ID}-open-manager-sheet-button`;
const FALLBACK_HP_CURRENT_PATH = "system.attributes.hp.value";
const FALLBACK_HP_MAX_PATH = "system.attributes.hp.max";

function openManagerForControlledToken() {
  const controlled = canvas?.tokens?.controlled?.[0]?.document ?? null;
  if (!controlled) {
    ui.notifications.warn("Select a token first.");
    return;
  }

  openManagerForTokenDocument(controlled);
}

function openManagerForActorById(actorId) {
  const actor = game.actors?.get(actorId) ?? null;
  if (!actor) {
    ui.notifications.warn("Actor not found.");
    return;
  }

  openManagerForActor(actor);
}

function resolveActorFromSheet(sheet) {
  return sheet?.actor ?? sheet?.document ?? sheet?.object ?? null;
}

function resolveTokenDocumentFromSheet(sheet) {
  return sheet?.token?.document ?? sheet?.token ?? null;
}

function pushActorSheetHeaderControl(sheetLike, controls) {
  const actor = resolveActorFromSheet(sheetLike);
  if (!actor || !actor.isOwner || !Array.isArray(controls)) return;

  const actionId = `${MODULE_ID}.open-manager`;
  const localized = game.i18n.localize("MTA.OpenManager");

  if (controls.some((control) =>
    control?.action === actionId
    || control?.class === ACTOR_SHEET_BUTTON_CLASS
    || control?.label === localized
    || control?.title === localized
  )) {
    return;
  }

  const tokenDocument = resolveTokenDocumentFromSheet(sheetLike);

  controls.unshift({
    action: actionId,
    class: ACTOR_SHEET_BUTTON_CLASS,
    icon: "fas fa-masks-theater",
    label: localized,
    title: localized,
    onClick: () => openManagerForActor(actor, tokenDocument)
  });
}

function registerActorHeaderButtons() {
  for (const hookName of [
    "getApplicationHeaderButtons",
    "getActorSheetHeaderButtons",
    "getApplicationV2HeaderButtons",
    "getHeaderControlsApplicationV2"
  ]) {
    Hooks.on(hookName, (application, controls) => {
      pushActorSheetHeaderControl(application, controls);
    });
  }
}

function getConfiguredHpPaths() {
  const currentPath = game.settings.get(MODULE_ID, SETTINGS.HP_CURRENT_PATH) || FALLBACK_HP_CURRENT_PATH;
  const maxPath = game.settings.get(MODULE_ID, SETTINGS.HP_MAX_PATH) || FALLBACK_HP_MAX_PATH;
  return { currentPath, maxPath };
}

function getParentPath(path) {
  if (typeof path !== "string") return null;
  const index = path.lastIndexOf(".");
  if (index <= 0) return null;
  return path.slice(0, index);
}

function hasChangedPathOrParent(changes, path) {
  if (!changes || !path) return false;
  if (foundry.utils.hasProperty(changes, path)) return true;

  const parentPath = getParentPath(path);
  if (parentPath && foundry.utils.hasProperty(changes, parentPath)) return true;

  return false;
}

function hasActorHpLikeChange(changes) {
  const { currentPath, maxPath } = getConfiguredHpPaths();
  return hasChangedPathOrParent(changes, currentPath) || hasChangedPathOrParent(changes, maxPath);
}

function hasTokenHpLikeChange(changes) {
  if (!changes) return false;

  const { currentPath, maxPath } = getConfiguredHpPaths();
  const hpPaths = [currentPath, maxPath];
  const prefixes = ["delta"];

  for (const hpPath of hpPaths) {
    if (!hpPath) continue;

    const parentPath = getParentPath(hpPath);

    for (const prefix of prefixes) {
      if (foundry.utils.hasProperty(changes, `${prefix}.${hpPath}`)) return true;
      if (parentPath && foundry.utils.hasProperty(changes, `${prefix}.${parentPath}`)) return true;
    }
  }

  return false;
}

function canCurrentUserUpdateToken(tokenDocument) {
  const user = game.user;
  if (!tokenDocument || !user) return false;
  if (user.isGM) return true;

  try {
    if (typeof tokenDocument.canUserModify === "function") {
      return tokenDocument.canUserModify(user, "update");
    }
  } catch (_error) {
    // noop
  }

  try {
    if (typeof tokenDocument.testUserPermission === "function") {
      const ownerLevel = CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER;
      if (Number.isFinite(ownerLevel)) {
        return tokenDocument.testUserPermission(user, ownerLevel);
      }
    }
  } catch (_error) {
    // noop
  }

  return Boolean(tokenDocument.isOwner);
}

function shouldCurrentUserRunTokenAutomation(tokenDocument) {
  if (!tokenDocument) return false;

  const user = game.user;
  if (!user) return false;

  // Выполняем автоматизацию только на активном ГМ, чтобы не дублировать апдейты
  // и не ловить ошибки прав у игроков при broadcast-хуках.
  if (user.isGM) {
    const activeGmId = game.users?.activeGM?.id ?? null;
    return !activeGmId || activeGmId === user.id;
  }

  // Пока в сессии есть активный ГМ, автоматизация токена выполняется только у него.
  // Для edge-case без активного ГМ разрешаем выполнить только при реальных правах update.
  if (game.users?.activeGM) return false;

  return canCurrentUserUpdateToken(tokenDocument);
}

function setModuleApi() {
  const module = game.modules.get(MODULE_ID);
  if (!module) return;

  module.api = {
    runAutoActivation,
    openManagerForTokenDocument,
    openManagerForActor,
    openManagerForActorById,
    // Aliases for easier macro/debug usage.
    openManager: openManagerForTokenDocument,
    openForControlledToken: openManagerForControlledToken,
    openForActor: openManagerForActor,
    openForActorById: openManagerForActorById
  };
}

// Per-actor debounce: коллапсирует несколько быстрых хуков (Пp + статус-эффект) в один вызов
// Ключ: дебаунс пересоздаётся при каждом вызове чтобы не замыкать устаревшего актора
const _actorAutoActivationDebounced = new Map();
const _actorAutoActivationRunning = new Set();

function scheduleAutoActivationForActor(actor) {
  if (!actor || !actorHasModuleFlags(actor)) return;

  const actorId = actor.id;
  if (!actorId) return;

  // ВАЖНО: НЕ используем game.actors.get(actorId)!
  // Для unlinked-токенов actor = синтетический актор с delta-флагами (autoRotate из токена).
  // game.actors.get() вернул бы базового актора без delta — с другим autoRotate!
  // Дебаунс пересоздаётся каждый раз чтобы захватывать актуальный actor-объект.
  const debouncedFn = foundry.utils.debounce(async () => {
    if (_actorAutoActivationRunning.has(actorId)) return;
    _actorAutoActivationRunning.add(actorId);
    try {
      if (!actorHasModuleFlags(actor)) return;
      for (const token of actor.getActiveTokens(true)) {
        const tokenDocument = token.document;
        if (tokenDocument && shouldCurrentUserRunTokenAutomation(tokenDocument)) {
          await runAutoActivation({ actor, tokenDocument });
        }
      }
    } finally {
      _actorAutoActivationRunning.delete(actorId);
    }
  }, 200);

  // Отменяем предыдущий pending-вызов если он есть
  const existing = _actorAutoActivationDebounced.get(actorId);
  if (existing) existing.cancel?.();
  _actorAutoActivationDebounced.set(actorId, debouncedFn);
  debouncedFn();
}

function resolveActorFromActiveEffect(effect) {
  const parent = effect?.parent;
  if (parent?.documentName === "Actor") return parent;
  return null;
}

Hooks.once("init", async () => {
  registerSettings();
  registerTokenHudButton();
  registerActorHeaderButtons();
  setModuleApi();

  await loadTemplates([
    "modules/multi-tokenart/templates/partials/image-card.hbs",
    "modules/multi-tokenart/templates/settings-panel.hbs"
  ]);
});

Hooks.once("ready", () => {
  applySystemPresetIfNeeded();
  registerFileSocketHandlers();
  // Re-apply API in case another package overwrote it after init.
  setModuleApi();

  globalThis.MultiTokenArtDebug = {
    openForControlledToken: openManagerForControlledToken,
    openManagerForTokenDocument,
    openManagerForActor,
    openManagerForActorById
  };
});

Hooks.on("updateActor", (actor, changes, options) => {
  if (options?.mtaManualUpdate) return;
  if (!actorHasModuleFlags(actor)) return;

  const hpChanged = hasActorHpLikeChange(changes);
  if (!hpChanged) return;

  scheduleAutoActivationForActor(actor);
});

Hooks.on("updateToken", (tokenDocument, changes, options) => {
  if (options?.mtaManualUpdate) return;

  const actor = tokenDocument.actor;
  if (!actor) return;
  if (!actorHasModuleFlags(actor)) return;

  const hpLikeChanged = hasTokenHpLikeChange(changes);
  if (!hpLikeChanged) return;

  // Для unlinked-токенов запускаем через дебаунс чтобы избежать совпадения с другими хуками
  scheduleAutoActivationForActor(actor);
});

Hooks.on("createActiveEffect", (effect, _options) => {
  const actor = resolveActorFromActiveEffect(effect);
  if (!actor) return;
  scheduleAutoActivationForActor(actor);
});

Hooks.on("updateActiveEffect", (effect, _changes, options) => {
  if (options?.mtaManualUpdate) return;
  const actor = resolveActorFromActiveEffect(effect);
  if (!actor) return;
  scheduleAutoActivationForActor(actor);
});

Hooks.on("deleteActiveEffect", (effect, _options) => {
  const actor = resolveActorFromActiveEffect(effect);
  if (!actor) return;
  scheduleAutoActivationForActor(actor);
});

Hooks.on("createToken", async (tokenDocument) => {
  console.log("[MTA] createToken hook fired", { tokenName: tokenDocument.name });

  if (!shouldCurrentUserRunTokenAutomation(tokenDocument)) return;

  const actor = tokenDocument.actor;
  if (!actor) return;
  if (!actorHasModuleFlags(actor)) return;

  const data = getActorModuleData(actor);
  const tokenImages = data.tokenImages ?? [];
  const portraitImages = data.portraitImages ?? [];

  const currentTokenSrc = tokenDocument.texture?.src ?? null;
  const currentPortraitSrc = actor.img ?? null;

  const defaultTokenImage = tokenImages.find((image) => image?.isDefault) ?? null;
  const defaultPortraitImage = portraitImages.find((image) => image?.isDefault) ?? null;

  const matchedTokenByCurrentSrc = currentTokenSrc
    ? tokenImages.find((image) => image?.src === currentTokenSrc) ?? null
    : null;

  const matchedPortraitByCurrentSrc = currentPortraitSrc
    ? portraitImages.find((image) => image?.src === currentPortraitSrc) ?? null
    : null;

  const rawActiveTokenImageId = tokenDocument.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_TOKEN_IMAGE_ID);
  const rawActivePortraitImageId = tokenDocument.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_PORTRAIT_IMAGE_ID);

  const selectedTokenImage = tokenImages.find((image) => image?.id === rawActiveTokenImageId)
    ?? matchedTokenByCurrentSrc
    ?? defaultTokenImage;

  // При копировании/вставке токена флаги активного образа обычно уже присутствуют.
  // В таком случае не перезаписываем их дефолтным/рандомным изображением до автоактивации.
  const hasExistingTokenSelection = Boolean(rawActiveTokenImageId);
  const hasExistingPortraitSelection = Boolean(rawActivePortraitImageId);

  if (!hasExistingTokenSelection && matchedTokenByCurrentSrc?.id) {
    await tokenDocument.setFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_TOKEN_IMAGE_ID, matchedTokenByCurrentSrc.id);
  }

  if (!hasExistingPortraitSelection && matchedPortraitByCurrentSrc?.id) {
    await tokenDocument.setFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_PORTRAIT_IMAGE_ID, matchedPortraitByCurrentSrc.id);
  }

  const initialTokenImage = data.global.tokenRandom
    ? pickRandomImage(tokenImages)
    : defaultTokenImage;

  const initialPortraitImage = data.global.portraitRandom
    ? pickRandomImage(portraitImages)
    : defaultPortraitImage;

  const shouldApplyInitialToken = data.global.tokenRandom || !hasExistingTokenSelection;
  const shouldApplyInitialPortrait = data.global.portraitRandom || !hasExistingPortraitSelection;

  if (shouldApplyInitialToken && initialTokenImage) {
    await applyTokenImageById({ actor, tokenDocument, imageId: initialTokenImage.id });
  } else if (selectedTokenImage) {
    // Важно для Dynamic Ring: если у токена уже выбран активный образ,
    // нужно принудительно применить его параметры (ring/scale),
    // иначе при первом появлении токена кольцо может не отрисоваться.
    await applyTokenImageById({ actor, tokenDocument, imageObject: selectedTokenImage });
  }
  if (shouldApplyInitialPortrait && initialPortraitImage && !data.global.linkTokenPortrait) {
    await applyPortraitById({ actor, tokenDocument, imageId: initialPortraitImage.id });
  }

  await runAutoActivation({ actor, tokenDocument });
});

Hooks.on("renderActorSheet", (sheet, htmlLike) => {
  const tokenDocument = sheet.token?.document;
  if (!tokenDocument) return;

  const actor = tokenDocument.actor;
  if (!actor) return;
  if (!actorHasModuleFlags(actor)) return;

  const data = getActorModuleData(actor);
  const activePortraitImageId = tokenDocument.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_PORTRAIT_IMAGE_ID);
  const activePortrait = data.portraitImages.find((image) => image.id === activePortraitImageId);
  if (!activePortrait?.src) return;

  // V13: normalise htmlLike — ApplicationV2 passes HTMLElement, legacy Application passes jQuery
  const element = htmlLike instanceof HTMLElement ? htmlLike : (htmlLike?.[0] ?? htmlLike);
  if (!element?.querySelector) return;

  const portrait = element.querySelector("img.profile, img[data-edit='img']");
  if (portrait) portrait.src = activePortrait.src;
});
