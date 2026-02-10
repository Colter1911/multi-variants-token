import { MODULE_ID, TOKEN_FLAG_KEYS } from "./constants.mjs";
import { registerSettings, applySystemPresetIfNeeded } from "./settings.mjs";
import { registerTokenHudButton } from "./ui/TokenHUD.mjs";
import { runAutoActivation, applyTokenImageById, applyPortraitById } from "./logic/AutoActivation.mjs";
import { pickRandomImage } from "./logic/RandomMode.mjs";
import { getActorModuleData } from "./utils/flag-utils.mjs";

Hooks.once("init", () => {
  registerSettings();
  game.modules.get(MODULE_ID).api = {
    runAutoActivation
  };
});

Hooks.once("ready", () => {
  applySystemPresetIfNeeded();
  registerTokenHudButton();
});

Hooks.on("updateActor", (actor, changes) => {
  const hpChanged = foundry.utils.hasProperty(changes, "system");
  if (!hpChanged) return;

  for (const tokenDocument of actor.getActiveTokens(true)) {
    void runAutoActivation({ actor, tokenDocument });
  }
});

Hooks.on("updateToken", (tokenDocument, changes) => {
  const hpLikeChanged = foundry.utils.hasProperty(changes, "delta") || foundry.utils.hasProperty(changes, "actorData");
  if (!hpLikeChanged) return;

  const actor = tokenDocument.actor;
  if (!actor) return;

  void runAutoActivation({ actor, tokenDocument });
});

Hooks.on("createToken", (tokenDocument) => {
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
