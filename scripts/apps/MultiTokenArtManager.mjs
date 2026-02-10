import { IMAGE_TYPES, MODULE_ID, TOKEN_FLAG_KEYS } from "../constants.mjs";
import { IMAGE_TYPES, MODULE_ID } from "../constants.mjs";
import { getActorModuleData } from "../utils/flag-utils.mjs";
import { pickRandomImage, sortImagesByOrder } from "../logic/RandomMode.mjs";
import { applyTokenImageById, applyPortraitById } from "../logic/AutoActivation.mjs";
import { SettingsPanel } from "./SettingsPanel.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class MultiTokenArtManager extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-manager`,
    tag: "section",
    classes: [MODULE_ID, "manager"],
    window: {
      title: "Multi Art",
      icon: "fas fa-masks-theater",
      contentClasses: ["mta-manager-content"]
    },
    position: {
      width: 900,
      height: 640
    }
  };

  static PARTS = {
    main: {
      template: "modules/multi-tokenart/templates/manager.hbs"
    }
  };

  constructor({ actor, tokenDocument } = {}) {
    super();
    this.actor = actor;
    this.tokenDocument = tokenDocument;
    this.settingsPanel = null;
  }

  async _prepareContext() {
    const data = getActorModuleData(this.actor);
    const tokenImages = sortImagesByOrder(data.tokenImages ?? []);
    const portraitImages = sortImagesByOrder(data.portraitImages ?? []);
    const activeTokenImageId = this.tokenDocument?.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_TOKEN_IMAGE_ID);
    const activePortraitImageId = this.tokenDocument?.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_PORTRAIT_IMAGE_ID);
    const activeTokenImageId = this.tokenDocument?.getFlag(MODULE_ID, "activeTokenImageId");
    const activePortraitImageId = this.tokenDocument?.getFlag(MODULE_ID, "activePortraitImageId");

    const tokenCards = tokenImages.map((image, idx) => ({
      ...image,
      idx,
      imageType: IMAGE_TYPES.TOKEN,
      active: image.id === activeTokenImageId
    }));

    const portraitCards = portraitImages.map((image, idx) => ({
      ...image,
      idx,
      imageType: IMAGE_TYPES.PORTRAIT,
      active: image.id === activePortraitImageId
    }));

    return {
      actor: this.actor,
      tokenDocument: this.tokenDocument,
      title: game.i18n.format("MTA.ManagerTitle", { name: this.actor?.name ?? "" }),
      global: data.global,
      tokenCards,
      portraitCards
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    this.element.querySelectorAll("[data-action='select-image']")
      .forEach((el) => el.addEventListener("click", (event) => this.#onSelectImage(event)));

    this.element.querySelectorAll("[data-action='open-settings']")
      .forEach((el) => el.addEventListener("click", (event) => this.#onOpenSettings(event)));

    this.element.querySelectorAll("[data-action='refresh-random']")
      .forEach((el) => el.addEventListener("click", (event) => this.#onRefreshRandom(event)));
  }

  async #onSelectImage(event) {
    const card = event.currentTarget.closest("[data-image-id]");
    if (!card) return;

    const imageType = card.dataset.imageType;
    const imageId = card.dataset.imageId;

    if (imageType === IMAGE_TYPES.TOKEN) {
      await applyTokenImageById({ actor: this.actor, tokenDocument: this.tokenDocument, imageId });
    } else {
      await applyPortraitById({ actor: this.actor, tokenDocument: this.tokenDocument, imageId });
    }

    this.render(true);
  }

  async #onOpenSettings(event) {
    event.stopPropagation();
    const card = event.currentTarget.closest("[data-image-id]");
    if (!card) return;

    const data = getActorModuleData(this.actor);
    const imageType = card.dataset.imageType;
    const index = Number(card.dataset.index ?? 0);
    const imageList = imageType === IMAGE_TYPES.TOKEN ? data.tokenImages : data.portraitImages;
    const image = imageList[index];

    this.settingsPanel?.close();
    this.settingsPanel = new SettingsPanel({
      actor: this.actor,
      image,
      imageType,
      index,
      randomEnabled: imageType === IMAGE_TYPES.TOKEN ? data.global.tokenRandom : data.global.portraitRandom
    });

    await this.settingsPanel.render({ force: true });
  }

  async #onRefreshRandom(event) {
    const imageType = event.currentTarget.dataset.imageType;
    const data = getActorModuleData(this.actor);
    const imageList = imageType === IMAGE_TYPES.TOKEN ? data.tokenImages : data.portraitImages;
    const selected = pickRandomImage(imageList);
    if (!selected) return;

    if (imageType === IMAGE_TYPES.TOKEN) {
      await applyTokenImageById({ actor: this.actor, tokenDocument: this.tokenDocument, imageId: selected.id });
    } else {
      await applyPortraitById({ actor: this.actor, tokenDocument: this.tokenDocument, imageId: selected.id });
    }

    this.render(true);
  }
}
