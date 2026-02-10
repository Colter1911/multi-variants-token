import { IMAGE_TYPES, MODULE_ID } from "../constants.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Slide-out settings panel for an image entry.
 */
export class SettingsPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-settings-panel`,
    tag: "section",
    classes: [MODULE_ID, "settings-panel"],
    window: {
      title: "Multi Token Art - Settings",
      contentClasses: ["mta-settings-content"]
    },
    position: {
      width: 320,
      height: "auto"
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
}
