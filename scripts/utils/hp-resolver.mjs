import { MODULE_ID, SETTINGS } from "../constants.mjs";

export function resolveHpData(actor) {
  const currentPath = game.settings.get(MODULE_ID, SETTINGS.HP_CURRENT_PATH);
  const maxPath = game.settings.get(MODULE_ID, SETTINGS.HP_MAX_PATH);

  const hpCurrent = Number(foundry.utils.getProperty(actor, currentPath) ?? 0);
  const hpMax = Number(foundry.utils.getProperty(actor, maxPath) ?? 0);
  const hpPercent = hpMax > 0 ? (hpCurrent / hpMax) * 100 : 0;

  return {
    current: hpCurrent,
    max: hpMax,
    percent: hpPercent
  };
}
