import { MODULE_ID } from "../constants.mjs";
import { MultiTokenArtManager } from "../apps/MultiTokenArtManager.mjs";

const HOOK_GUARD = Symbol.for("multi-tokenart.hud-hooks-registered");
const HUD_BUTTON_CLASS = "control-icon multi-tokenart-open-manager";

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

  const side = buttons?.left ?? buttons?.right ?? buttons?.main ?? null;
  if (Array.isArray(side)) {
    side.push(button);
  }
}

function injectHudButton(hud, htmlLike) {
  const tokenLike = hud?.object?.document ?? hud?.object ?? hud?.token ?? null;
  if (!tokenLike) return;

  const tokenDocument = tokenLike?.document ?? tokenLike;
  const actor = tokenDocument?.actor ?? tokenLike?.actor;
  if (!actor || !actor.isOwner) return;

  const root = htmlLike?.[0] ?? htmlLike;
  if (!root?.querySelector) return;
  if (root.querySelector(".multi-tokenart-open-manager")) return;

  const column = root.querySelector(".col.left") ?? root.querySelector(".left") ?? root;
  const button = document.createElement("div");
  button.className = HUD_BUTTON_CLASS;
  button.dataset.action = `${MODULE_ID}-open-manager`;
  button.title = game.i18n.localize("MTA.TokenHUDButton");
  button.innerHTML = '<i class="fas fa-masks-theater"></i>';
  button.addEventListener("click", () => openManagerForTokenLike(tokenLike));

  column.appendChild(button);
}

export function registerTokenHudButton() {
  if (globalThis[HOOK_GUARD]) return;
  globalThis[HOOK_GUARD] = true;

  Hooks.on("getTokenActionButtons", (tokenLike, buttons) => {
    pushButton(buttons, tokenLike);
  });

  Hooks.on("getTokenHUDButtons", (hud, buttons) => {
    const tokenLike = hud?.object?.document ?? hud?.object ?? hud?.token ?? hud;
    pushButton(buttons, tokenLike);
  });

  // Hard fallback: directly inject button into TokenHUD DOM.
  Hooks.on("renderTokenHUD", (hud, html) => {
    injectHudButton(hud, html);
  });
}
