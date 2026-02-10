import { MODULE_ID } from "../constants.mjs";
import { MultiTokenArtManager } from "../apps/MultiTokenArtManager.mjs";

const HOOK_GUARD = Symbol.for("multi-tokenart.hud-hooks-registered");
const HUD_BUTTON_CLASS = "control-icon multi-tokenart-open-manager";

function isTokenHudApplication(app) {
  const tokenHudClass = foundry?.applications?.hud?.TokenHUD;
  if (tokenHudClass && app instanceof tokenHudClass) return true;
  return app?.constructor?.name === "TokenHUD";
}

function resolveTokenDocument(tokenLike) {
  return tokenLike?.document ?? tokenLike ?? null;
}

function openManagerForTokenLike(tokenLike) {
  const tokenDocument = resolveTokenDocument(tokenLike);
  const actor = tokenDocument?.actor ?? tokenLike?.actor;
  if (!actor || !actor.isOwner) return;

  const app = new MultiTokenArtManager({ actor, tokenDocument });
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
  if (Array.isArray(side)) side.push(button);
}

function createHudButton(tokenLike) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = HUD_BUTTON_CLASS;
  button.dataset.action = `${MODULE_ID}-open-manager`;
  button.title = game.i18n.localize("MTA.TokenHUDButton");
  button.ariaLabel = button.title;
  button.innerHTML = '<i class="fas fa-masks-theater"></i>';
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openManagerForTokenLike(tokenLike);
  });
  return button;
}

function injectHudButtonFromTokenLike(tokenLike, element) {
  const tokenDocument = resolveTokenDocument(tokenLike);
  const actor = tokenDocument?.actor ?? tokenLike?.actor;
  if (!actor || !actor.isOwner || !element?.querySelector) return;
  if (element.querySelector(".multi-tokenart-open-manager")) return;

  const column = element.querySelector(".col.left") ?? element.querySelector(".col") ?? element;
  column.appendChild(createHudButton(tokenLike));
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

  // Foundry v13 ApplicationV2 hook: reliable fallback for TokenHUD.
  Hooks.on("renderApplicationV2", (application, element) => {
    if (!isTokenHudApplication(application)) return;
    injectHudButtonFromTokenLike(application.object, element);
  });

  // Legacy compatibility fallback.
  Hooks.on("renderTokenHUD", (hud, htmlLike) => {
    const element = htmlLike?.[0] ?? htmlLike;
    injectHudButtonFromTokenLike(hud?.object?.document ?? hud?.object ?? hud, element);
  });
}

export function openManagerForTokenDocument(tokenDocument) {
  openManagerForTokenLike(tokenDocument);
}
