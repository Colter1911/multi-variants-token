import { IMAGE_TYPES, MODULE_ID } from "../constants.mjs";
import { getActorModuleData, setActorModuleData } from "../utils/flag-utils.mjs";

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
      handler: SettingsPanel.prototype._updateObject,
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

    return {
      actorName: this.actor?.name ?? "",
      image: this.image,
      imageType: this.imageType,
      label: `${labelPrefix} ${this.index + 1}`,
      isToken: this.imageType === IMAGE_TYPES.TOKEN,
      randomEnabled: this.randomEnabled
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

  async _updateObject(event, formData) {
    const data = getActorModuleData(this.actor);
    const list = this.imageType === IMAGE_TYPES.TOKEN ? data.tokenImages : data.portraitImages;

    // Use expandObject to handle dot notation (e.g. autoEnable.wounded)
    const activeImage = list[this.index];
    if (!activeImage) return;

    const expanded = foundry.utils.expandObject(formData);

    // Merge updates into the specific image object
    foundry.utils.mergeObject(activeImage, expanded);

    // If this is set to default, unset others
    if (activeImage.isDefault) {
      list.forEach((img, i) => {
        if (i !== this.index) img.isDefault = false;
      });
    }

    await setActorModuleData(this.actor, data);

    // Refresh manager if open
    const manager = Object.values(ui.windows).find((w) => w.id === `${MODULE_ID}-manager`);
    manager?.render(true);
  }

  async #onDelete() {
    const confirmed = await Dialog.confirm({
      title: "Delete Image?",
      content: "<p>Are you sure you want to delete this image setting?</p>",
      defaultYes: false
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
    const fp = new FilePicker({
      type: "image",
      current: input.value,
      callback: path => {
        input.value = path;
      }
    });
    fp.browse();
  }
}
