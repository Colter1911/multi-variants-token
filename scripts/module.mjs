import { MODULE_ID, TOKEN_FLAG_KEYS } from "./constants.mjs";
import { registerSettings, applySystemPresetIfNeeded } from "./settings.mjs";
import { registerTokenHudButton, openManagerForTokenDocument, openManagerForActor } from "./ui/TokenHUD.mjs";
import { registerFileSocketHandlers } from "./utils/file-utils.mjs";
import { runAutoActivation, applyTokenImageById, applyPortraitById } from "./logic/AutoActivation.mjs";
import { pickRandomImage } from "./logic/RandomMode.mjs";
import { getActorModuleData } from "./utils/flag-utils.mjs";

console.log("✅ Multi Token Art | module.mjs loaded");

const ACTOR_SHEET_BUTTON_CLASS = `${MODULE_ID}-open-manager-sheet-button`;

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
  if (!actor) return;

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
  // Проверяем что изменились именно HP (более точная проверка чем просто "system")
  const hpChanged = foundry.utils.hasProperty(changes, "system.attributes.hp") ||
    foundry.utils.hasProperty(changes, "system.attributes.hp.value") ||
    foundry.utils.hasProperty(changes, "system");
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
  const hpLikeChanged = foundry.utils.hasProperty(changes, "delta") || foundry.utils.hasProperty(changes, "actorData");
  if (!hpLikeChanged) return;

  const actor = tokenDocument.actor;
  if (!actor) return;

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

  const data = getActorModuleData(actor);

  // При копировании/вставке токена флаги активного образа обычно уже присутствуют.
  // В таком случае не перезаписываем их дефолтным/рандомным изображением до автоактивации.
  const hasExistingTokenSelection = Boolean(
    tokenDocument.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_TOKEN_IMAGE_ID)
  );
  const hasExistingPortraitSelection = Boolean(
    tokenDocument.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_PORTRAIT_IMAGE_ID)
  );

  const initialTokenImage = data.global.tokenRandom
    ? pickRandomImage(data.tokenImages)
    : data.tokenImages.find((image) => image.isDefault) ?? null;

  const initialPortraitImage = data.global.portraitRandom
    ? pickRandomImage(data.portraitImages)
    : data.portraitImages.find((image) => image.isDefault) ?? null;

  const shouldApplyInitialToken = data.global.tokenRandom || !hasExistingTokenSelection;
  const shouldApplyInitialPortrait = data.global.portraitRandom || !hasExistingPortraitSelection;

  if (shouldApplyInitialToken && initialTokenImage) {
    await applyTokenImageById({ actor, tokenDocument, imageId: initialTokenImage.id });
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

  const data = getActorModuleData(actor);
  const activePortraitImageId = tokenDocument.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_PORTRAIT_IMAGE_ID);
  const activePortrait = data.portraitImages.find((image) => image.id === activePortraitImageId);
  if (!activePortrait?.src) return;

  const portrait = html.querySelector("img.profile, img[data-edit='img']");
  if (portrait) portrait.src = activePortrait.src;
});
