import { MODULE_ID } from "./constants.mjs";
import { registerSettings, applySystemPresetIfNeeded } from "./settings.mjs";
import { registerTokenHudButton } from "./ui/TokenHUD.mjs";
import { runAutoActivation } from "./logic/AutoActivation.mjs";

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

  void runAutoActivation({ actor, tokenDocument });
});
