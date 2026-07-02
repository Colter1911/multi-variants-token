export const MODULE_ID = "multi-tokenart";

export const SETTINGS = {
  HP_CURRENT_PATH: "hpCurrentPath",
  HP_MAX_PATH: "hpMaxPath",
  SYSTEM_MODE: "systemMode",
  SYSTEM_PROMPTED: "systemPrompted"
};

export const SYSTEM_MODES = {
  AUTO: "auto",
  DND5E: "dnd5e",
  PF2E: "pf2e",
  WFRP4E: "wfrp4e",
  CUSTOM: "custom"
};

export const DEFAULT_HP_PATHS = {
  [SETTINGS.HP_CURRENT_PATH]: "system.attributes.hp.value",
  [SETTINGS.HP_MAX_PATH]: "system.attributes.hp.max"
};

export const IMAGE_LIMIT = 100;

export const MANUAL_DYNAMIC_RING_FIT_FACTOR = 0.9;

export const IMAGE_TYPES = {
  TOKEN: "token",
  PORTRAIT: "portrait"
};

export const MTA_EFFECT_ATTRIBUTES = {
  TOKEN_IMAGE_INDEX: "mta.settoken",
  PORTRAIT_IMAGE_INDEX: "mta.setportrait"
};

export const STATUS_CONDITIONS = Object.freeze([
  "Bleeding",
  "Blinded",
  "Burning",
  "Burrowing",
  "Charmed",
  "Concentrating",
  "Cursed",
  "Dead",
  "Deafened",
  "Dehydration",
  "Diseased",
  "Dodging",
  "Encumbered",
  "Ethereal",
  "Exceeding Carrying Capacity",
  "Exhaustion",
  "Falling",
  "Flanked",
  "Flanking",
  "Flying",
  "Frightened",
  "Grappled",
  "Half Cover",
  "Heavily Encumbered",
  "Hiding",
  "Hovering",
  "Inaudible",
  "Incapacitated",
  "Invisible",
  "Malnutrition",
  "Marked",
  "Paralyzed",
  "Petrified",
  "Poisoned",
  "Prone",
  "Reaction used",
  "Restrained",
  "Silenced",
  "Sleeping",
  "Stable",
  "Stunned",
  "Suffocation",
  "Surprised",
  "Three-Quarters Cover",
  "Total Cover",
  "Transformed",
  "Unconscious"
]);

export const TOKEN_FLAG_KEYS = {
  ACTIVE_TOKEN_IMAGE_ID: "activeTokenImageId",
  ACTIVE_PORTRAIT_IMAGE_ID: "activePortraitImageId",
  ORIGINAL_RING: "originalRing",
  ORIGINAL_ROTATION: "originalRotation",
  LAST_UPDATE: "lastUpdate",
  MANAGED_TOKEN_IMAGE_SRC: "managedTokenImageSrc",
  EXTERNAL_TOKEN_IMAGE_SRC: "externalTokenImageSrc",
  PRE_EXTERNAL_TOKEN_IMAGE_ID: "preExternalTokenImageId"
};
