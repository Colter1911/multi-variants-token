import { MODULE_ID, SETTINGS } from "../constants.mjs";

export function resolveHpData(actor) {
  // Constants might be undefined during early init, but here we should be fine
  const currentPath = game.settings.get(MODULE_ID, SETTINGS.HP_CURRENT_PATH) || "system.attributes.hp.value";
  const maxPath = game.settings.get(MODULE_ID, SETTINGS.HP_MAX_PATH) || "system.attributes.hp.max";

  const hpCurrent = Number(foundry.utils.getProperty(actor, currentPath) ?? 0);
  const hpMax = Number(foundry.utils.getProperty(actor, maxPath) ?? 0);
  const hpPercent = hpMax > 0 ? (hpCurrent / hpMax) * 100 : 0;

  /*
  console.log("[MTA] resolveHpData", { 
    name: actor.name, 
    currentPath, 
    maxPath, 
    current: hpCurrent, 
    max: hpMax 
  });
  */

  return {
    current: hpCurrent,
    max: hpMax,
    percent: hpPercent
  };
}
