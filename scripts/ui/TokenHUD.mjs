import { MODULE_ID } from "../constants.mjs";
import { MultiTokenArtManager } from "../apps/MultiTokenArtManager.mjs";

export function registerTokenHudButton() {
  Hooks.on("getTokenActionButtons", (token, buttons) => {
    const actor = token?.actor;
    if (!actor || !actor.isOwner) return;

    buttons.push({
      name: `${MODULE_ID}-open-manager`,
      title: game.i18n.localize("MTA.TokenHUDButton"),
      icon: "fas fa-masks-theater",
      onClick: () => {
        const app = new MultiTokenArtManager({
          actor,
          tokenDocument: token.document
        });

        void app.render({ force: true });
      }
    });
  });
}
