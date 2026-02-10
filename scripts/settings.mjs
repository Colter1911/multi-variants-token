import { DEFAULT_HP_PATHS, MODULE_ID, SETTINGS } from "./constants.mjs";

/**
 * Register world-level module settings.
 */
export function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.HP_CURRENT_PATH, {
    name: "MTA HP Current Path",
    hint: "Path to current HP value in actor system data.",
    scope: "world",
    config: true,
    type: String,
    default: DEFAULT_HP_PATHS[SETTINGS.HP_CURRENT_PATH]
  });

  game.settings.register(MODULE_ID, SETTINGS.HP_MAX_PATH, {
    name: "MTA HP Max Path",
    hint: "Path to max HP value in actor system data.",
    scope: "world",
    config: true,
    type: String,
    default: DEFAULT_HP_PATHS[SETTINGS.HP_MAX_PATH]
  });
}

export function applySystemPresetIfNeeded() {
  const presets = {
    dnd5e: {
      [SETTINGS.HP_CURRENT_PATH]: "system.attributes.hp.value",
      [SETTINGS.HP_MAX_PATH]: "system.attributes.hp.max"
    },
    pf2e: {
      [SETTINGS.HP_CURRENT_PATH]: "system.attributes.hp.value",
      [SETTINGS.HP_MAX_PATH]: "system.attributes.hp.max"
    },
    wfrp4e: {
      [SETTINGS.HP_CURRENT_PATH]: "system.status.wounds.value",
      [SETTINGS.HP_MAX_PATH]: "system.status.wounds.max"
    }
  };

  const preset = presets[game.system.id];
  if (!preset) return;

  const currentPath = game.settings.get(MODULE_ID, SETTINGS.HP_CURRENT_PATH);
  const maxPath = game.settings.get(MODULE_ID, SETTINGS.HP_MAX_PATH);

  const isDefault =
    currentPath === DEFAULT_HP_PATHS[SETTINGS.HP_CURRENT_PATH] &&
    maxPath === DEFAULT_HP_PATHS[SETTINGS.HP_MAX_PATH];

  if (!isDefault) return;

  void game.settings.set(MODULE_ID, SETTINGS.HP_CURRENT_PATH, preset[SETTINGS.HP_CURRENT_PATH]);
  void game.settings.set(MODULE_ID, SETTINGS.HP_MAX_PATH, preset[SETTINGS.HP_MAX_PATH]);
}
