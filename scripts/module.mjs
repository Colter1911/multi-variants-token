import { MODULE_ID, MTA_EFFECT_ATTRIBUTES, TOKEN_FLAG_KEYS } from "./constants.mjs";
import { registerSettings, applySystemPresetIfNeeded, showFirstRunSystemDialogIfNeeded } from "./settings.mjs";
import { getConfiguredHpPaths as getConfiguredSystemHpPaths, isPf2eConditionItem } from "./system-support.mjs";
import { registerTokenHudButton, openManagerForTokenDocument, openManagerForActor } from "./ui/TokenHUD.mjs";
import { getActiveGm, registerFileSocketHandlers } from "./utils/file-utils.mjs";
import {
  runAutoActivation,
  applyTokenImageById,
  applyPortraitById,
  handleExternalTokenImageChange,
  activeEffectHasMtaImageOverride
} from "./logic/AutoActivation.mjs";
import { pickRandomImage } from "./logic/RandomMode.mjs";
import { actorHasModuleFlags, getActorModuleData } from "./utils/flag-utils.mjs";

console.log("✅ Multi Token Art | module.mjs loaded");

const ACTOR_SHEET_BUTTON_CLASS = `${MODULE_ID}-open-manager-sheet-button`;
const MTA_EFFECT_FORCE_OPTIONS = {
  forceTokenImageUpdate: true,
  forcePortraitImageUpdate: true,
  ignoreManualSelection: true
};

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

function createActorSheetHeaderControl({ actionId, localized, open }) {
  return {
    action: actionId,
    class: ACTOR_SHEET_BUTTON_CLASS,
    icon: "fas fa-masks-theater",
    label: localized,
    title: localized,
    onClick: open,
    onclick: open,
    callback: open
  };
}

function headerControlMatches(control, actionId, localized) {
  return control?.action === actionId
    || control?.class === ACTOR_SHEET_BUTTON_CLASS
    || control?.label === localized
    || control?.title === localized;
}

function insertActorSheetHeaderControl(controls, control, actionId, localized) {
  if (Array.isArray(controls)) {
    if (!controls.some((entry) => headerControlMatches(entry, actionId, localized))) controls.unshift(control);
    return;
  }

  if (controls instanceof Map) {
    if (![...controls.values()].some((entry) => headerControlMatches(entry, actionId, localized))) {
      controls.set(actionId, control);
    }
    return;
  }

  if (!controls || typeof controls !== "object") return;

  const values = Object.values(controls);
  if (values.some((entry) => headerControlMatches(entry, actionId, localized))) return;

  for (const value of values) {
    if (Array.isArray(value)) {
      insertActorSheetHeaderControl(value, control, actionId, localized);
      return;
    }
  }

  controls[actionId] = control;
}

function pushActorSheetHeaderControl(sheetLike, controls) {
  const actor = resolveActorFromSheet(sheetLike);
  if (!actor || !actor.isOwner) return;

  const actionId = `${MODULE_ID}.open-manager`;
  const localized = game.i18n.localize("MTA.OpenManager");
  const tokenDocument = resolveTokenDocumentFromSheet(sheetLike);
  const open = (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    openManagerForActor(actor, tokenDocument);
  };

  insertActorSheetHeaderControl(
    controls,
    createActorSheetHeaderControl({ actionId, localized, open }),
    actionId,
    localized
  );
}

function bindActorSheetHeaderControl(sheetLike, htmlLike) {
  const actor = resolveActorFromSheet(sheetLike);
  if (!actor || !actor.isOwner) return;

  const roots = [
    htmlLike instanceof HTMLElement ? htmlLike : (htmlLike?.[0] ?? htmlLike),
    sheetLike?.element instanceof HTMLElement ? sheetLike.element : null,
    sheetLike?.id ? document.getElementById(sheetLike.id) : null
  ].filter((root, index, list) => root?.querySelectorAll && list.indexOf(root) === index);

  if (!roots.length) return;

  const tokenDocument = resolveTokenDocumentFromSheet(sheetLike);
  const selector = `.${ACTOR_SHEET_BUTTON_CLASS}, [data-action='${MODULE_ID}.open-manager']`;
  for (const root of roots) {
    for (const button of root.querySelectorAll(selector)) {
      if (button.dataset.mtaClickBound === "true") continue;
      button.dataset.mtaClickBound = "true";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openManagerForActor(actor, tokenDocument);
      }, { capture: true });
    }
  }
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
  return getConfiguredSystemHpPaths();
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

function hasTokenTextureSrcChange(changes) {
  return Boolean(changes && foundry.utils.hasProperty(changes, "texture.src"));
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
  const activeGm = getActiveGm();
  if (user.isGM) {
    const activeGmId = activeGm?.id ?? null;
    return !activeGmId || activeGmId === user.id;
  }

  // Пока в сессии есть активный ГМ, автоматизация токена выполняется только у него.
  // Для edge-case без активного ГМ разрешаем выполнить только при реальных правах update.
  if (activeGm) return false;

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
const _tokenAutoActivationDebounced = new Map();
const _tokenAutoActivationRunning = new Set();

async function runAutoActivationForActor(actor, runOptions = {}) {
  if (!actor || !actorHasModuleFlags(actor)) return;

  for (const token of actor.getActiveTokens(true)) {
    const tokenDocument = token.document;
    if (tokenDocument && shouldCurrentUserRunTokenAutomation(tokenDocument)) {
      await runAutoActivation({ actor, tokenDocument, ...runOptions });
    }
  }
}

function scheduleAutoActivationForActor(actor, runOptions = {}) {
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
      await runAutoActivationForActor(actor, runOptions);
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

async function runAutoActivationForTokenDocument(tokenDocument, runOptions = {}) {
  const actor = tokenDocument?.actor;
  if (!actor || !actorHasModuleFlags(actor)) return;
  if (!shouldCurrentUserRunTokenAutomation(tokenDocument)) return;
  await runAutoActivation({ actor, tokenDocument, ...runOptions });
}

function scheduleAutoActivationForTokenDocument(tokenDocument, runOptions = {}) {
  if (!tokenDocument) return;

  const actor = tokenDocument.actor;
  if (!actor || !actorHasModuleFlags(actor)) return;

  const key = tokenDocument.uuid ?? `${tokenDocument.parent?.id ?? "scene"}.${tokenDocument.id ?? foundry.utils.randomID()}`;
  if (!key) return;

  const debouncedFn = foundry.utils.debounce(async () => {
    if (_tokenAutoActivationRunning.has(key)) return;
    _tokenAutoActivationRunning.add(key);
    try {
      await runAutoActivationForTokenDocument(tokenDocument, runOptions);
    } finally {
      _tokenAutoActivationRunning.delete(key);
    }
  }, 200);

  const existing = _tokenAutoActivationDebounced.get(key);
  if (existing) existing.cancel?.();
  _tokenAutoActivationDebounced.set(key, debouncedFn);
  debouncedFn();
}

function resolveActorFromActiveEffect(effect) {
  const parent = effect?.parent;
  if (parent?.documentName === "Actor") return parent;
  return null;
}

function resolveActorFromEmbeddedItem(item) {
  const parent = item?.parent;
  if (parent?.documentName === "Actor") return parent;
  return null;
}

function normalizeEffectChangeKey(key) {
  return String(key ?? "").trim().toLowerCase();
}

function hasMtaOverrideChangeEntry(change) {
  const key = normalizeEffectChangeKey(change?.key);
  return key === MTA_EFFECT_ATTRIBUTES.TOKEN_IMAGE_INDEX
    || key === MTA_EFFECT_ATTRIBUTES.PORTRAIT_IMAGE_INDEX;
}

function getIterableValues(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return Array.from(value);
  if (value instanceof Map) return Array.from(value.values());
  if (typeof value.values === "function") return Array.from(value.values());
  if (value?.[Symbol.iterator]) return Array.from(value);
  if (typeof value === "object") return Object.values(value);
  return [];
}

function activeEffectChangePayloadTouchesOverrides(changes) {
  if (!changes) return false;

  const candidates = [
    changes,
    changes.changes,
    changes.system?.changes,
    foundry.utils.getProperty(changes, "changes"),
    foundry.utils.getProperty(changes, "system.changes")
  ];

  for (const candidate of candidates) {
    const entries = getIterableValues(candidate);
    if (entries.some(hasMtaOverrideChangeEntry)) return true;
  }

  return foundry.utils.hasProperty(changes, "changes")
    || foundry.utils.hasProperty(changes, "system.changes");
}

function getActiveEffectRunOptions(effect, changes = null) {
  return activeEffectHasMtaImageOverride(effect) || activeEffectChangePayloadTouchesOverrides(changes)
    ? MTA_EFFECT_FORCE_OPTIONS
    : {};
}

function resolveCombatantTokenDocument(combatant) {
  if (combatant?.token?.document) return combatant.token.document;
  if (combatant?.token?.documentName === "Token") return combatant.token;
  if (combatant?.tokenDocument?.documentName === "Token") return combatant.tokenDocument;

  const tokenId = combatant?.tokenId ?? null;
  if (!tokenId) return null;

  const scene = combatant?.scene
    ?? (combatant?.sceneId ? game.scenes?.get(combatant.sceneId) : null)
    ?? canvas?.scene
    ?? null;

  return scene?.tokens?.get?.(tokenId) ?? null;
}

function getCombatantsFromCombat(combat) {
  return combat?.combatants ? Array.from(combat.combatants) : [];
}

function scheduleAutoActivationForCombatant(combatant, runOptions = {}) {
  const tokenDocument = resolveCombatantTokenDocument(combatant);
  if (tokenDocument) {
    scheduleAutoActivationForTokenDocument(tokenDocument, runOptions);
    return;
  }

  const actor = combatant?.actor ?? null;
  if (actor) scheduleAutoActivationForActor(actor, runOptions);
}

function scheduleAutoActivationForCombat(combat, runOptions = {}) {
  for (const combatant of getCombatantsFromCombat(combat)) {
    scheduleAutoActivationForCombatant(combatant, runOptions);
  }
}

function hasCombatActivationChange(changes) {
  if (!changes) return true;
  return foundry.utils.hasProperty(changes, "started")
    || foundry.utils.hasProperty(changes, "round")
    || foundry.utils.hasProperty(changes, "active")
    || foundry.utils.hasProperty(changes, "scene")
    || foundry.utils.hasProperty(changes, "combatants");
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

Hooks.once("ready", async () => {
  await applySystemPresetIfNeeded();
  registerFileSocketHandlers();
  // Re-apply API in case another package overwrote it after init.
  setModuleApi();

  // Force Dynamic Ring Scaling to "grid" — required for correct ring rendering.
  if (game.user.isGM) {
    try {
      const current = game.settings.get("core", "dynamicTokenRingScaling");
      if (current !== "grid") {
        game.settings.set("core", "dynamicTokenRingScaling", "grid");
        console.log("[MTA] Dynamic Ring Scaling set to 'grid'");
      }
    } catch (_err) {
      // Setting may not exist in this Foundry version — skip silently.
    }
  }

  globalThis.MultiTokenArtDebug = {
    openForControlledToken: openManagerForControlledToken,
    openManagerForTokenDocument,
    openManagerForActor,
    openManagerForActorById
  };

  void showFirstRunSystemDialogIfNeeded();
});

Hooks.on("renderApplicationV2", (application, element) => {
  bindActorSheetHeaderControl(application, element);
  window.setTimeout(() => bindActorSheetHeaderControl(application, element), 0);
});

Hooks.on("updateActor", (actor, changes, options) => {
  if (options?.mtaManualUpdate) return;
  if (!actorHasModuleFlags(actor)) return;

  const hpChanged = hasActorHpLikeChange(changes);
  if (!hpChanged) return;

  scheduleAutoActivationForActor(actor);
});

Hooks.on("updateToken", async (tokenDocument, changes, options) => {
  if (options?.mtaManualUpdate) return;

  const actor = tokenDocument.actor;
  if (!actor) return;
  if (!actorHasModuleFlags(actor)) return;

  if (hasTokenTextureSrcChange(changes)) {
    if (!shouldCurrentUserRunTokenAutomation(tokenDocument)) return;

    const newSrc = foundry.utils.getProperty(changes, "texture.src") ?? tokenDocument.texture?.src ?? null;
    const result = await handleExternalTokenImageChange({ actor, tokenDocument, newSrc });
    if (result?.reset || result?.matchedModuleImage) {
      await runAutoActivation({ actor, tokenDocument, ...MTA_EFFECT_FORCE_OPTIONS });
    }
    return;
  }

  const hpLikeChanged = hasTokenHpLikeChange(changes);
  if (!hpLikeChanged) return;

  // Для unlinked-токенов запускаем через дебаунс чтобы избежать совпадения с другими хуками
  scheduleAutoActivationForActor(actor);
});

Hooks.on("createActiveEffect", (effect, _options) => {
  const actor = resolveActorFromActiveEffect(effect);
  if (!actor) return;
  scheduleAutoActivationForActor(actor, getActiveEffectRunOptions(effect));
});

Hooks.on("updateActiveEffect", (effect, changes, options) => {
  if (options?.mtaManualUpdate) return;
  const actor = resolveActorFromActiveEffect(effect);
  if (!actor) return;
  scheduleAutoActivationForActor(actor, getActiveEffectRunOptions(effect, changes));
});

Hooks.on("deleteActiveEffect", (effect, _options) => {
  const actor = resolveActorFromActiveEffect(effect);
  if (!actor) return;
  scheduleAutoActivationForActor(actor, getActiveEffectRunOptions(effect));
});

Hooks.on("createItem", (item, _options) => {
  if (!isPf2eConditionItem(item)) return;
  const actor = resolveActorFromEmbeddedItem(item);
  if (!actor) return;
  scheduleAutoActivationForActor(actor);
});

Hooks.on("updateItem", (item, _changes, options) => {
  if (options?.mtaManualUpdate) return;
  if (!isPf2eConditionItem(item)) return;
  const actor = resolveActorFromEmbeddedItem(item);
  if (!actor) return;
  scheduleAutoActivationForActor(actor);
});

Hooks.on("deleteItem", (item, _options) => {
  if (!isPf2eConditionItem(item)) return;
  const actor = resolveActorFromEmbeddedItem(item);
  if (!actor) return;
  scheduleAutoActivationForActor(actor);
});

Hooks.on("createCombat", (combat, _options) => {
  scheduleAutoActivationForCombat(combat);
});

Hooks.on("updateCombat", (combat, changes, options) => {
  if (options?.mtaManualUpdate) return;
  if (!hasCombatActivationChange(changes)) return;
  scheduleAutoActivationForCombat(combat);
});

Hooks.on("deleteCombat", (combat, _options) => {
  scheduleAutoActivationForCombat(combat);
});

Hooks.on("createCombatant", (combatant, _options) => {
  scheduleAutoActivationForCombatant(combatant);
});

Hooks.on("updateCombatant", (combatant, _changes, options) => {
  if (options?.mtaManualUpdate) return;
  scheduleAutoActivationForCombatant(combatant);
});

Hooks.on("deleteCombatant", (combatant, _options) => {
  scheduleAutoActivationForCombatant(combatant);
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
  bindActorSheetHeaderControl(sheet, htmlLike);

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
