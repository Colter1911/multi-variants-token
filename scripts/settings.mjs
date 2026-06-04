import { DEFAULT_HP_PATHS, MODULE_ID, SETTINGS, SYSTEM_MODES } from "./constants.mjs";
import { getDetectedSystemMode, getHpPresetForMode, getSystemModeChoices } from "./system-support.mjs";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Register world-level module settings.
 */
export function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.SYSTEM_MODE, {
    name: game.i18n.localize("MTA.SystemModeSettingName"),
    hint: game.i18n.localize("MTA.SystemModeSettingHint"),
    scope: "world",
    config: true,
    type: String,
    choices: getSystemModeChoices(),
    default: SYSTEM_MODES.AUTO,
    onChange: (mode) => {
      void applySystemPresetIfNeeded(mode, { force: true });
    }
  });

  game.settings.register(MODULE_ID, SETTINGS.SYSTEM_PROMPTED, {
    name: "MTA System Prompted",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, SETTINGS.HP_CURRENT_PATH, {
    name: game.i18n.localize("MTA.HpCurrentPathSettingName"),
    hint: game.i18n.localize("MTA.HpCurrentPathSettingHint"),
    scope: "world",
    config: true,
    type: String,
    default: DEFAULT_HP_PATHS[SETTINGS.HP_CURRENT_PATH]
  });

  game.settings.register(MODULE_ID, SETTINGS.HP_MAX_PATH, {
    name: game.i18n.localize("MTA.HpMaxPathSettingName"),
    hint: game.i18n.localize("MTA.HpMaxPathSettingHint"),
    scope: "world",
    config: true,
    type: String,
    default: DEFAULT_HP_PATHS[SETTINGS.HP_MAX_PATH]
  });
}

export async function applySystemPresetIfNeeded(mode = null, { force = false } = {}) {
  const preset = getHpPresetForMode(mode);
  if (!preset) return;

  const currentPath = game.settings.get(MODULE_ID, SETTINGS.HP_CURRENT_PATH);
  const maxPath = game.settings.get(MODULE_ID, SETTINGS.HP_MAX_PATH);

  const isDefault =
    currentPath === DEFAULT_HP_PATHS[SETTINGS.HP_CURRENT_PATH] &&
    maxPath === DEFAULT_HP_PATHS[SETTINGS.HP_MAX_PATH];

  if (!force && !isDefault) return;

  await game.settings.set(MODULE_ID, SETTINGS.HP_CURRENT_PATH, preset[SETTINGS.HP_CURRENT_PATH]);
  await game.settings.set(MODULE_ID, SETTINGS.HP_MAX_PATH, preset[SETTINGS.HP_MAX_PATH]);
}

function resolveDialogRoot(htmlLike) {
  if (htmlLike instanceof HTMLElement) return htmlLike;
  return htmlLike?.[0] ?? htmlLike ?? null;
}

function isActiveGm() {
  if (!game.user?.isGM) return false;
  const activeGmId = game.users?.activeGM?.id ?? null;
  return !activeGmId || activeGmId === game.user.id;
}

export async function showFirstRunSystemDialogIfNeeded() {
  if (!isActiveGm()) return false;
  if (game.settings.get(MODULE_ID, SETTINGS.SYSTEM_PROMPTED)) return false;

  const choices = getSystemModeChoices();
  const selectedMode = getDetectedSystemMode() ?? SYSTEM_MODES.AUTO;
  const options = Object.entries(choices)
    .map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === selectedMode ? "selected" : ""}>${escapeHtml(label)}</option>`)
    .join("");

  const content = `
    <form class="mta-system-choice-dialog">
      <header class="mta-system-choice-header">
        <i class="fas fa-masks-theater" aria-hidden="true"></i>
        <h2>${escapeHtml(game.i18n.localize("MTA.FirstRunSystemDialogTitle"))}</h2>
      </header>
      <p class="mta-system-choice-description">${escapeHtml(game.i18n.localize("MTA.FirstRunSystemDialogContent"))}</p>
      <div class="mta-system-choice-field">
        <label for="mta-system-mode-select">${escapeHtml(game.i18n.localize("MTA.SystemModeSettingName"))}</label>
        <select id="mta-system-mode-select" name="systemMode">${options}</select>
      </div>
    </form>
  `;

  return new Promise((resolve) => {
    let submitted = false;
    const dialog = new Dialog({
      title: game.i18n.localize("MTA.FirstRunSystemDialogTitle"),
      content,
      buttons: {
        confirm: {
          icon: "<i class='fas fa-check'></i>",
          label: game.i18n.localize("MTA.FirstRunSystemDialogConfirm"),
          callback: async (html) => {
            submitted = true;
            const root = resolveDialogRoot(html);
            const systemMode = root?.querySelector?.("[name='systemMode']")?.value ?? SYSTEM_MODES.AUTO;
            await game.settings.set(MODULE_ID, SETTINGS.SYSTEM_MODE, systemMode);
            await applySystemPresetIfNeeded(systemMode, { force: true });
            await game.settings.set(MODULE_ID, SETTINGS.SYSTEM_PROMPTED, true);
            resolve(true);
          }
        }
      },
      default: "confirm",
      close: () => {
        if (!submitted) resolve(false);
      }
    }, {
      classes: [MODULE_ID, "mta-system-choice-window"],
      width: 430,
      resizable: false
    });

    dialog.render(true);
  });
}
