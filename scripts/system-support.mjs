import { DEFAULT_HP_PATHS, MODULE_ID, SETTINGS, STATUS_CONDITIONS, SYSTEM_MODES } from "./constants.mjs";

const GENERIC_STATUS_OPTIONS = STATUS_CONDITIONS.map((label) => ({ value: label, label }));

const PF2E_STATUS_OPTIONS = Object.freeze([
  { value: "blinded", label: "Blinded" },
  { value: "broken", label: "Broken" },
  { value: "clumsy", label: "Clumsy" },
  { value: "concealed", label: "Concealed" },
  { value: "confused", label: "Confused" },
  { value: "controlled", label: "Controlled" },
  { value: "dazzled", label: "Dazzled" },
  { value: "deafened", label: "Deafened" },
  { value: "doomed", label: "Doomed" },
  { value: "drained", label: "Drained" },
  { value: "dying", label: "Dying" },
  { value: "encumbered", label: "Encumbered" },
  { value: "enfeebled", label: "Enfeebled" },
  { value: "fascinated", label: "Fascinated" },
  { value: "fatigued", label: "Fatigued" },
  { value: "fleeing", label: "Fleeing" },
  { value: "frightened", label: "Frightened" },
  { value: "grabbed", label: "Grabbed" },
  { value: "hidden", label: "Hidden" },
  { value: "immobilized", label: "Immobilized" },
  { value: "invisible", label: "Invisible" },
  { value: "observed", label: "Observed" },
  { value: "off-guard", label: "Off-Guard" },
  { value: "paralyzed", label: "Paralyzed" },
  { value: "persistent-damage", label: "Persistent Damage" },
  { value: "petrified", label: "Petrified" },
  { value: "prone", label: "Prone" },
  { value: "quickened", label: "Quickened" },
  { value: "restrained", label: "Restrained" },
  { value: "sickened", label: "Sickened" },
  { value: "slowed", label: "Slowed" },
  { value: "stunned", label: "Stunned" },
  { value: "stupefied", label: "Stupefied" },
  { value: "unconscious", label: "Unconscious" },
  { value: "undetected", label: "Undetected" },
  { value: "unnoticed", label: "Unnoticed" },
  { value: "wounded", label: "Wounded" }
]);

export const SYSTEM_PRESETS = Object.freeze({
  [SYSTEM_MODES.DND5E]: {
    hpPaths: {
      [SETTINGS.HP_CURRENT_PATH]: "system.attributes.hp.value",
      [SETTINGS.HP_MAX_PATH]: "system.attributes.hp.max"
    },
    statusOptions: GENERIC_STATUS_OPTIONS
  },
  [SYSTEM_MODES.PF2E]: {
    hpPaths: {
      [SETTINGS.HP_CURRENT_PATH]: "system.attributes.hp.value",
      [SETTINGS.HP_MAX_PATH]: "system.attributes.hp.max"
    },
    statusOptions: PF2E_STATUS_OPTIONS
  },
  [SYSTEM_MODES.WFRP4E]: {
    hpPaths: {
      [SETTINGS.HP_CURRENT_PATH]: "system.status.wounds.value",
      [SETTINGS.HP_MAX_PATH]: "system.status.wounds.max"
    },
    statusOptions: GENERIC_STATUS_OPTIONS
  }
});

function localize(key) {
  return game.i18n?.localize(key) ?? key;
}

export function getSystemModeChoices() {
  return {
    [SYSTEM_MODES.AUTO]: localize("MTA.SystemModeAuto"),
    [SYSTEM_MODES.DND5E]: localize("MTA.SystemModeDnd5e"),
    [SYSTEM_MODES.PF2E]: localize("MTA.SystemModePf2e"),
    [SYSTEM_MODES.WFRP4E]: localize("MTA.SystemModeWfrp4e"),
    [SYSTEM_MODES.CUSTOM]: localize("MTA.SystemModeCustom")
  };
}

export function getDetectedSystemMode() {
  const systemId = String(game.system?.id ?? "").trim();
  return SYSTEM_PRESETS[systemId] ? systemId : null;
}

export function normalizeSystemMode(mode) {
  const value = String(mode ?? "").trim();
  if (value === SYSTEM_MODES.AUTO || value === SYSTEM_MODES.CUSTOM || SYSTEM_PRESETS[value]) return value;
  return SYSTEM_MODES.AUTO;
}

export function getSelectedSystemMode() {
  const mode = game.settings.get(MODULE_ID, SETTINGS.SYSTEM_MODE);
  return normalizeSystemMode(mode);
}

export function resolveSystemMode(mode = null) {
  const selected = normalizeSystemMode(mode ?? getSelectedSystemMode());
  if (selected === SYSTEM_MODES.AUTO) return getDetectedSystemMode() ?? SYSTEM_MODES.CUSTOM;
  return selected;
}

export function getHpPresetForMode(mode = null) {
  const resolved = resolveSystemMode(mode);
  return SYSTEM_PRESETS[resolved]?.hpPaths ?? null;
}

export function getConfiguredHpPaths() {
  const currentPath = game.settings.get(MODULE_ID, SETTINGS.HP_CURRENT_PATH)
    || DEFAULT_HP_PATHS[SETTINGS.HP_CURRENT_PATH];
  const maxPath = game.settings.get(MODULE_ID, SETTINGS.HP_MAX_PATH)
    || DEFAULT_HP_PATHS[SETTINGS.HP_MAX_PATH];

  return { currentPath, maxPath };
}

export function getStatusOptionsForSelectedSystem() {
  const resolved = resolveSystemMode();
  return SYSTEM_PRESETS[resolved]?.statusOptions ?? GENERIC_STATUS_OPTIONS;
}

export function normalizeStatusValue(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function pushStatusValue(statuses, value) {
  if (value === null || value === undefined) return;
  if (typeof value === "object") {
    if (value instanceof Map || value instanceof Set || Array.isArray(value)) {
      pushIterableStatuses(statuses, value);
      return;
    }

    pushDocumentStatusValues(statuses, value);
    return;
  }

  const raw = String(value).trim();
  if (!raw) return;
  statuses.add(raw);
}

function pushIterableStatuses(statuses, values) {
  if (!values) return;

  if (values instanceof Map) {
    for (const entry of values.values()) pushStatusValue(statuses, entry);
    return;
  }

  if (values instanceof Set || Array.isArray(values) || values?.[Symbol.iterator]) {
    for (const entry of values) pushStatusValue(statuses, entry);
    return;
  }

  if (typeof values === "object") {
    for (const entry of Object.values(values)) pushStatusValue(statuses, entry);
  }
}

function pushDocumentStatusValues(statuses, document) {
  if (!document) return;

  pushStatusValue(statuses, document.name);
  pushStatusValue(statuses, document.label);
  pushStatusValue(statuses, document.statusId);
  pushStatusValue(statuses, document.slug);
  pushStatusValue(statuses, document.id);
  pushStatusValue(statuses, document._id);
  pushStatusValue(statuses, foundry.utils.getProperty(document, "system.slug"));
  pushStatusValue(statuses, foundry.utils.getProperty(document, "system.hud.statusName"));
  pushStatusValue(statuses, foundry.utils.getProperty(document, "flags.core.statusId"));

  if (typeof document.getFlag === "function") {
    try {
      pushStatusValue(statuses, document.getFlag("core", "statusId"));
    } catch (_err) {
      // Some synthetic documents can throw while reading flags.
    }
  }

  pushIterableStatuses(statuses, document.statuses);
  pushIterableStatuses(statuses, document.traits);
  pushIterableStatuses(statuses, foundry.utils.getProperty(document, "system.traits.value"));
  pushIterableStatuses(statuses, foundry.utils.getProperty(document, "system.statuses"));
  pushIterableStatuses(statuses, foundry.utils.getProperty(document, "system.traits"));

  const nestedStatus = document?.statuses?.status;
  if (Array.isArray(nestedStatus)) pushIterableStatuses(statuses, nestedStatus);
}

export function isPf2eConditionItem(item) {
  return resolveSystemMode() === SYSTEM_MODES.PF2E && item?.type === "condition";
}

function collectPf2eConditionStatuses(statuses, actor) {
  if (!actor || resolveSystemMode() !== SYSTEM_MODES.PF2E) return;

  const itemTypesConditions = actor.itemTypes?.condition;
  if (itemTypesConditions) {
    for (const condition of itemTypesConditions) pushDocumentStatusValues(statuses, condition);
  }

  const actorItems = actor.items;
  if (actorItems) {
    for (const item of actorItems) {
      if (item?.type === "condition") pushDocumentStatusValues(statuses, item);
    }
  }

  const actorConditions = actor.conditions;
  if (actorConditions?.[Symbol.iterator]) {
    for (const condition of actorConditions) pushDocumentStatusValues(statuses, condition);
  }

  const activeConditions = actorConditions?.active;
  if (activeConditions?.[Symbol.iterator]) {
    for (const condition of activeConditions) pushDocumentStatusValues(statuses, condition);
  }
}

export function getTokenStatusValues(tokenDoc) {
  if (!tokenDoc) return [];

  const statuses = new Set();

  const actorEffects = tokenDoc.actor?.effects;
  if (actorEffects) {
    for (const effect of actorEffects) {
      if (effect?.disabled) continue;
      pushDocumentStatusValues(statuses, effect);
    }
  }

  const tokenEffects = tokenDoc.effects;
  pushIterableStatuses(statuses, tokenEffects);

  pushIterableStatuses(statuses, tokenDoc.statuses);
  collectPf2eConditionStatuses(statuses, tokenDoc.actor);

  if (typeof tokenDoc.hasStatusEffect === "function") {
    for (const status of Array.from(statuses)) {
      const normalized = normalizeStatusValue(status);
      if (!normalized) continue;
      try {
        if (tokenDoc.hasStatusEffect(normalized)) pushStatusValue(statuses, normalized);
      } catch (_err) {
        // ignore hasStatusEffect failures for malformed ids
      }
    }
  }

  return Array.from(statuses);
}

export function hasMatchingStatus(statusValues, wantedStatus) {
  const wanted = normalizeStatusValue(wantedStatus);
  if (!wanted) return false;
  return statusValues.some((statusValue) => normalizeStatusValue(statusValue) === wanted);
}
