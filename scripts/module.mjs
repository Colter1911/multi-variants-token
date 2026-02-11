import { MODULE_ID, TOKEN_FLAG_KEYS } from "./constants.mjs";
import { registerSettings, applySystemPresetIfNeeded } from "./settings.mjs";
import { registerTokenHudButton, openManagerForTokenDocument } from "./ui/TokenHUD.mjs";
import { runAutoActivation, applyTokenImageById, applyPortraitById } from "./logic/AutoActivation.mjs";
import { pickRandomImage } from "./logic/RandomMode.mjs";
import { getActorModuleData } from "./utils/flag-utils.mjs";

console.log("✅ Multi Token Art | module.mjs loaded");

function openManagerForControlledToken() {
  const controlled = canvas?.tokens?.controlled?.[0]?.document ?? null;
  if (!controlled) {
    ui.notifications.warn("Select a token first.");
    return;
  }

  openManagerForTokenDocument(controlled);
}

function setModuleApi() {
  const module = game.modules.get(MODULE_ID);
  if (!module) return;

  module.api = {
    runAutoActivation,
    openManagerForTokenDocument,
    // Aliases for easier macro/debug usage.
    openManager: openManagerForTokenDocument,
    openForControlledToken: openManagerForControlledToken
  };
}

Hooks.once("init", async () => {
  registerSettings();
  registerTokenHudButton();
  setModuleApi();

  await loadTemplates([
    "modules/multi-tokenart/templates/partials/image-card.hbs",
    "modules/multi-tokenart/templates/settings-panel.hbs"
  ]);
});

Hooks.once("ready", () => {
  applySystemPresetIfNeeded();
  // Re-apply API in case another package overwrote it after init.
  setModuleApi();

  globalThis.MultiTokenArtDebug = {
    openForControlledToken: openManagerForControlledToken,
    openManagerForTokenDocument
  };
});

Hooks.on("updateActor", (actor, changes) => {
  console.log("[MTA] updateActor hook fired", { actorName: actor.name, changes });
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
  for (const token of actor.getActiveTokens(true)) {
    const tokenDocument = token.document;
    console.log("[MTA] Processing token", { tokenName: token.name, hasDocument: !!tokenDocument });
    if (tokenDocument) {
      void runAutoActivation({ actor, tokenDocument });
    }
  }
});

Hooks.on("updateToken", (tokenDocument, changes) => {
  console.log("[MTA] updateToken hook fired", { tokenName: tokenDocument.name, changes });
  const hpLikeChanged = foundry.utils.hasProperty(changes, "delta") || foundry.utils.hasProperty(changes, "actorData");
  if (!hpLikeChanged) return;

  const actor = tokenDocument.actor;
  if (!actor) return;

  void runAutoActivation({ actor, tokenDocument });
});

Hooks.on("createToken", (tokenDocument) => {
  console.log("[MTA] createToken hook fired", { tokenName: tokenDocument.name });
  const actor = tokenDocument.actor;
  if (!actor) return;

  const data = getActorModuleData(actor);

  const initialTokenImage = data.global.tokenRandom
    ? pickRandomImage(data.tokenImages)
    : data.tokenImages.find((image) => image.isDefault) ?? null;

  const initialPortraitImage = data.global.portraitRandom
    ? pickRandomImage(data.portraitImages)
    : data.portraitImages.find((image) => image.isDefault) ?? null;

  if (initialTokenImage) void applyTokenImageById({ actor, tokenDocument, imageId: initialTokenImage.id });
  if (initialPortraitImage) void applyPortraitById({ actor, tokenDocument, imageId: initialPortraitImage.id });

  void runAutoActivation({ actor, tokenDocument });
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
