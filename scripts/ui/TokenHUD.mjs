import { MODULE_ID } from "../constants.mjs";
import { MultiTokenArtManager } from "../apps/MultiTokenArtManager.mjs";

const HOOK_GUARD = Symbol.for("multi-tokenart.hud-hooks-registered");

function openManagerForTokenLike(tokenLike) {
  const tokenDocument = tokenLike?.document ?? tokenLike;
  const actor = tokenDocument?.actor ?? tokenLike?.actor;
  if (!actor || !actor.isOwner) return;

  const app = new MultiTokenArtManager({
    actor,
    tokenDocument
  });

  void app.render({ force: true });
}

function buildButtonConfig(tokenLike) {
  return {
    name: `${MODULE_ID}-open-manager`,
    title: game.i18n.localize("MTA.TokenHUDButton"),
    icon: "fas fa-masks-theater",
    buttonClass: `${MODULE_ID}-open-manager`,
    onClick: () => openManagerForTokenLike(tokenLike),
    callback: () => openManagerForTokenLike(tokenLike)
  };
}

function pushButton(buttons, tokenLike) {
  const button = buildButtonConfig(tokenLike);

  if (Array.isArray(buttons)) {
    buttons.push(button);
    return;
  }

  // Some Foundry versions/use-cases expose side collections.
  const side = buttons?.left ?? buttons?.right ?? buttons?.main ?? null;
  if (Array.isArray(side)) {
    side.push(button);
  }
}

export function registerTokenHudButton() {
  if (globalThis[HOOK_GUARD]) return;
  globalThis[HOOK_GUARD] = true;

  // Spec-targeted hook.
  Hooks.on("getTokenActionButtons", (tokenLike, buttons) => {
    pushButton(buttons, tokenLike);
  });

  // Compatibility fallback used by HUD implementations.
  Hooks.on("getTokenHUDButtons", (hud, buttons) => {
    const tokenLike = hud?.object?.document ?? hud?.object ?? hud?.token ?? hud;
    pushButton(buttons, tokenLike);
  });
}
