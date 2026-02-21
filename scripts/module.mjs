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
    onClick: () => openManagerForActor(actor, tokenDocument),
    onclick: () => openManagerForActor(actor, tokenDocument),
    callback: () => openManagerForActor(actor, tokenDocument)
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
  const prefixes = ["delta", "actorData", "actorData.data"];

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

function runAutoActivationForActorTokens(actor) {
  if (!actor || !actorHasModuleFlags(actor)) return;

  for (const token of actor.getActiveTokens(true)) {
    const tokenDocument = token.document;
    console.log("[MTA] Processing token", { tokenName: token.name, hasDocument: !!tokenDocument });
    if (tokenDocument) {
      void runAutoActivation({ actor, tokenDocument });
    }
  }
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
  console.log("[MTA] updateActor hook fired", { actorName: actor.name, changes });

  if (options && options.mtaManualUpdate) {
    console.log("[MTA] Ignoring manual update (mtaManualUpdate=true)");
    return;
  }

  if (!actorHasModuleFlags(actor)) {
    return;
  }

  const hpChanged = hasActorHpLikeChange(changes);
  if (!hpChanged) {
    console.log("[MTA] HP not changed, skipping");
    return;
  }

  console.log("[MTA] HP changed detected, running auto-activation");
  // ВАЖНО: getActiveTokens(true) возвращает Token objects, нужны TokenDocuments
  runAutoActivationForActorTokens(actor);
});

Hooks.on("updateToken", (tokenDocument, changes, options) => {
  console.log("[MTA] updateToken hook fired", { tokenName: tokenDocument.name, changes });

  if (options && options.mtaManualUpdate) {
    console.log("[MTA] Ignoring manual update (mtaManualUpdate=true)");
    return;
  }

  const actor = tokenDocument.actor;
  if (!actor) return;
  if (!actorHasModuleFlags(actor)) return;

  const hpLikeChanged = hasTokenHpLikeChange(changes);
  if (!hpLikeChanged) return;

  void runAutoActivation({ actor, tokenDocument });
});

Hooks.on("createActiveEffect", (effect, _options) => {
  const actor = resolveActorFromActiveEffect(effect);
  if (!actor) return;

  console.log("[MTA] createActiveEffect detected, running auto-activation", { actorName: actor.name, effectName: effect.name });
  runAutoActivationForActorTokens(actor);
});

Hooks.on("updateActiveEffect", (effect, _changes, options) => {
  if (options?.mtaManualUpdate) return;

  const actor = resolveActorFromActiveEffect(effect);
  if (!actor) return;

  console.log("[MTA] updateActiveEffect detected, running auto-activation", { actorName: actor.name, effectName: effect.name });
  runAutoActivationForActorTokens(actor);
});

Hooks.on("deleteActiveEffect", (effect, _options) => {
  const actor = resolveActorFromActiveEffect(effect);
  if (!actor) return;

  console.log("[MTA] deleteActiveEffect detected, running auto-activation", { actorName: actor.name, effectName: effect.name });
  runAutoActivationForActorTokens(actor);
});

Hooks.on("createToken", async (tokenDocument) => {
  console.log("[MTA] createToken hook fired", { tokenName: tokenDocument.name });
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

Hooks.on("renderActorSheet", (sheet, html) => {
  const tokenDocument = sheet.token?.document;
  if (!tokenDocument) return;

  const actor = tokenDocument.actor;
  if (!actor) return;
  if (!actorHasModuleFlags(actor)) return;

  const data = getActorModuleData(actor);
  const activePortraitImageId = tokenDocument.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_PORTRAIT_IMAGE_ID);
  const activePortrait = data.portraitImages.find((image) => image.id === activePortraitImageId);
  if (!activePortrait?.src) return;

  const portrait = html.querySelector("img.profile, img[data-edit='img']");
  if (portrait) portrait.src = activePortrait.src;
});
