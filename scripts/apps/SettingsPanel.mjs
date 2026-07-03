import { IMAGE_TYPES, MODULE_ID } from "../constants.mjs";
import { getStatusOptionsForSelectedSystem, normalizeStatusValue } from "../system-support.mjs";
import { getActorModuleData, setActorModuleData } from "../utils/flag-utils.mjs";
import { getFilePickerClass } from "../utils/file-utils.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Slide-out settings panel for an image entry.
 */
export class SettingsPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-settings-panel`,
    tag: "form",
    classes: [MODULE_ID, "settings-panel"],
    window: {
      title: "Multi Token Art - Settings",
      contentClasses: ["mta-settings-content"]
    },
    position: {
      width: 320,
      height: "auto"
    },
    form: {
      handler: SettingsPanel.#onSubmit,
      submitOnChange: false,
      closeOnSubmit: true
    }
  };

  static PARTS = {
    main: {
      template: "modules/multi-tokenart/templates/settings-panel.hbs"
    }
  };

  constructor({ actor, image, imageType, index, randomEnabled = false } = {}) {
    super();
    this.actor = actor;
    this.image = image;
    this.imageType = imageType ?? IMAGE_TYPES.TOKEN;
    this.index = index ?? 0;
    this.randomEnabled = randomEnabled;
  }

  async _prepareContext() {
    const labelPrefix = this.imageType === IMAGE_TYPES.TOKEN ? "Token" : "Portrait";
    const selectedStatus = String(this.image?.autoEnable?.status ?? "");
    const normalizedSelectedStatus = normalizeStatusValue(selectedStatus);
    const systemStatusOptions = getStatusOptionsForSelectedSystem();
    const hasSelectedInPreset = systemStatusOptions.some((option) => {
      return normalizeStatusValue(option.value) === normalizedSelectedStatus;
    });
    const statusOptions = [
      {
        value: "",
        label: game.i18n.localize("MTA.StatusNotSelected"),
        selected: !selectedStatus
      },
      ...systemStatusOptions.map((option) => ({
        value: option.value,
        label: option.label,
        selected: normalizeStatusValue(option.value) === normalizedSelectedStatus
      }))
    ];

    if (selectedStatus && !hasSelectedInPreset) {
      statusOptions.push({
        value: selectedStatus,
        label: selectedStatus,
        selected: true
      });
    }

    return {
      actorName: this.actor?.name ?? "",
      image: this.image,
      imageType: this.imageType,
      label: `${labelPrefix} ${this.index + 1}`,
      isToken: this.imageType === IMAGE_TYPES.TOKEN,
      randomEnabled: this.randomEnabled,
      statusOptions
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    this.element.querySelector("[data-action='delete']")
      ?.addEventListener("click", () => this.#onDelete());

    // File picker binding
    this.element.querySelector("[data-action='browse']")
      ?.addEventListener("click", (event) => this.#onBrowse(event));
  }

  // V13 ApplicationV2 form handler signature: (event, form, formData)
  static async #onSubmit(event, form, formData) {
    const data = getActorModuleData(this.actor);
    const list = this.imageType === IMAGE_TYPES.TOKEN ? data.tokenImages : data.portraitImages;

    const activeImage = list[this.index];
    if (!activeImage) return;

    // FormDataExtended.object уже есть плоский объект полей формы
    const expanded = foundry.utils.expandObject(formData.object);
    foundry.utils.mergeObject(activeImage, expanded);

    if (activeImage.isDefault) {
      list.forEach((img, i) => {
        if (i !== this.index) img.isDefault = false;
      });
    }

    await setActorModuleData(this.actor, data);

    const manager = Object.values(ui.windows).find((w) => w.id === `${MODULE_ID}-manager`);
    manager?.render(true);
  }

  async #onDelete() {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("MTA.DeleteImageTitle") },
      content: `<p>${game.i18n.localize("MTA.DeleteImageContent")}</p>`,
      rejectClose: false,
      modal: true
    });

    if (!confirmed) return;

    const data = getActorModuleData(this.actor);
    const list = this.imageType === IMAGE_TYPES.TOKEN ? data.tokenImages : data.portraitImages;

    list.splice(this.index, 1);
    await setActorModuleData(this.actor, data);

    const manager = Object.values(ui.windows).find((w) => w.id === `${MODULE_ID}-manager`);
    manager?.render(true);

    this.close();
  }

  #onBrowse(event) {
    const input = event.currentTarget.previousElementSibling;
    const FilePickerClass = getFilePickerClass();
    if (!FilePickerClass) {
      ui.notifications.error("FilePicker is not available.");
      return;
    }

    const picker = new FilePickerClass({
      type: "image",
      current: input.value,
      callback: (path) => { input.value = path; }
    });
    picker.browse(input.value);
  }
}
