export const MODULE_ID = "multi-tokenart";

export const FLAG_KEYS = {
  ACTOR_ROOT: MODULE_ID,
  TOKEN_ROOT: MODULE_ID
};

export const SETTINGS = {
  HP_CURRENT_PATH: "hpCurrentPath",
  HP_MAX_PATH: "hpMaxPath"
};

export const DEFAULT_HP_PATHS = {
  [SETTINGS.HP_CURRENT_PATH]: "system.attributes.hp.value",
  [SETTINGS.HP_MAX_PATH]: "system.attributes.hp.max"
};

export const IMAGE_LIMIT = 100;

export const IMAGE_TYPES = {
  TOKEN: "token",
  PORTRAIT: "portrait"
};
