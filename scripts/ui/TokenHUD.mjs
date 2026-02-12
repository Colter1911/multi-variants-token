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
    icon: "fas fa-user-cog",
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
  button.innerHTML = '<i class="fas fa-user-cog"></i>';
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

  console.log("Multi Token Art | TokenHUD Hook Fired for:", tokenDocument?.name);

  if (!actor) {
    console.warn("Multi Token Art | No actor found for token:", tokenDocument?.name);
    return;
  }

  if (!actor.isOwner) {
    console.warn("Multi Token Art | User is not owner of:", actor.name);
    return;
  }

  if (!element || !element.querySelector) {
    console.warn("Multi Token Art | HUD element invalid:", element);
    return;
  }

  if (element.querySelector(".multi-tokenart-open-manager")) {
    console.log("Multi Token Art | Button already exists.");
    return;
  }

  // Ensure we are working with the main container
  let container = element;
  if (!container.classList?.contains("token-hud")) {
    const parent = container.closest?.(".token-hud");
    if (parent) container = parent;
  }

  // Fallback: If passed element is detached or invalid, look for the global Token HUD
  if ((!container || container === element) && document.getElementById("token-hud")) {
    const globalHud = document.getElementById("token-hud");
    // Verify this is the right HUD for the token (if possible? usually strictly one HUD)
    container = globalHud;
  }

  // Try specific column divs first. Prioritize right column for tools.
  let column = container.querySelector("div.col.right");
  if (!column) column = container.querySelector("div.col.left");

  // Basic fallback to any col div but verify it's a div
  if (!column) column = container.querySelector("div.col");

  // Ultimate fallback to the element itself, but ensure we don't inject into void elements
  if (!column && container === element) {
    const tagName = element.tagName.toLowerCase();
    const voidElements = ["input", "img", "br", "hr", "area", "base", "col", "embed", "source", "track", "wbr"];
    if (voidElements.includes(tagName)) {
      console.warn("Multi Token Art | Cannot inject into void element (and no container found):", element);
      return;
    }
    column = element;
  }

  if (!column && container !== element) {
    column = container; // If we found a parent/global container, inject there
  }

  if (!column) {
    console.warn("Multi Token Art | Could not find column to inject button into. Element:", element);
    return;
  }

  // Double check we are not inside an input even if querySelector found it
  if (column.tagName.toLowerCase() === "input") {
    console.warn("Multi Token Art | Selected column is an input, aborting injection:", column);
    return;
  }

  console.log("Multi Token Art | Injecting button into:", column);
  column.appendChild(createHudButton(tokenLike));
}

export function registerTokenHudButton() {
  if (globalThis[HOOK_GUARD]) return;
  globalThis[HOOK_GUARD] = true;
  console.log("Multi Token Art | Registering TokenHUD hooks...");

  Hooks.on("getTokenActionButtons", (tokenLike, buttons) => {
    console.log("Multi Token Art | getTokenActionButtons hook fired.");
    pushButton(buttons, tokenLike);
  });

  Hooks.on("getTokenHUDButtons", (hud, buttons) => {
    console.log("Multi Token Art | getTokenHUDButtons hook fired.");
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
