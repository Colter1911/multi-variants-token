import { getConfiguredHpPaths } from "../system-support.mjs";

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value ?? fallback);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function resolveHpData(actor) {
  const { currentPath, maxPath } = getConfiguredHpPaths();

  const hpCurrent = toFiniteNumber(foundry.utils.getProperty(actor, currentPath), 0);
  const hpMax = toFiniteNumber(foundry.utils.getProperty(actor, maxPath), 0);
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
