export const MODULE_ID = "multi-tokenart";
export const DEBUG_VERSION = "v0.4.19";

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

export const TOKEN_FLAG_KEYS = {
  ACTIVE_TOKEN_IMAGE_ID: "activeTokenImageId",
  ACTIVE_PORTRAIT_IMAGE_ID: "activePortraitImageId",
  ORIGINAL_RING: "originalRing",
  ORIGINAL_ROTATION: "originalRotation"
};
