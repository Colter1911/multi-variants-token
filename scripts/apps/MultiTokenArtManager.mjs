import { IMAGE_LIMIT, IMAGE_TYPES, MODULE_ID, TOKEN_FLAG_KEYS } from "../constants.mjs";
import { getActorModuleData, setActorModuleData } from "../utils/flag-utils.mjs";
import { uploadFileToActorFolder } from "../utils/file-utils.mjs";
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
    this.activeSettings = null; // { index, imageType }
  }

  async _prepareContext() {
    const data = getActorModuleData(this.actor);
    let changed = false;

    // 1. Initialize default Token Image if empty
    if (!data.tokenImages || data.tokenImages.length === 0) {
      // Use current token texture or prototype
      const defaultSrc = this.tokenDocument?.texture?.src ?? this.actor.prototypeToken?.texture?.src ?? "icons/svg/mystery-man.svg";
      data.tokenImages = [{
        id: foundry.utils.randomID(),
        src: defaultSrc,
        sort: 0,
        isDefault: true,
        autoEnable: { wounded: false, woundedPercent: 50, die: false },
        customScript: "",
        dynamicRing: { enabled: false, scaleCorrection: 1, ringColor: "#000000", backgroundColor: "#000000" }
      }];
      changed = true;
    }

    // 2. Initialize default Portrait Image if empty
    if (!data.portraitImages || data.portraitImages.length === 0) {
      const defaultSrc = this.actor.img ?? "icons/svg/mystery-man.svg";
      data.portraitImages = [{
        id: foundry.utils.randomID(),
        src: defaultSrc,
        sort: 0,
        isDefault: true,
        autoEnable: { wounded: false, woundedPercent: 50, die: false },
        customScript: "",
        dynamicRing: { enabled: false, scaleCorrection: 1, ringColor: "#000000", backgroundColor: "#000000" } // Dynamic Ring irrelevant for portrait, but keeping schema consistent is easier
      }];
      changed = true;
    }

    if (changed) {
      await setActorModuleData(this.actor, data);
      // data is now updated, proceed with it
    }

    const tokenImages = sortImagesByOrder(data.tokenImages ?? []);
    const portraitImages = sortImagesByOrder(data.portraitImages ?? []);
    const activeTokenImageId = this.tokenDocument?.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_TOKEN_IMAGE_ID);
    const activePortraitImageId = this.tokenDocument?.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_PORTRAIT_IMAGE_ID);

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

    let activeSettingsData = null;
    if (this.activeSettings) {
      const { index, imageType } = this.activeSettings;
      const list = imageType === IMAGE_TYPES.TOKEN ? tokenImages : portraitImages;
      const image = list[index];
      if (image) {
        activeSettingsData = {
          label: `${imageType === IMAGE_TYPES.TOKEN ? "Token" : "Portrait"} #${index + 1}`,
          image,
          imageType,
          index,
          isToken: imageType === IMAGE_TYPES.TOKEN,
          randomEnabled: imageType === IMAGE_TYPES.TOKEN ? data.global.tokenRandom : data.global.portraitRandom
        };
      } else {
        this.activeSettings = null; // Image might have been deleted
      }
    }

    return {
      actor: this.actor,
      tokenDocument: this.tokenDocument,
      title: game.i18n.format("MTA.ManagerTitle", { name: this.actor?.name ?? "" }),
      global: data.global,
      tokenCards,
      portraitCards,
      activeSettings: activeSettingsData
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

    this.element.querySelectorAll("[data-action='add-image']")
      .forEach((el) => el.addEventListener("click", (event) => this.#onAddImage(event)));

    this.element.querySelectorAll("[data-action='toggle-global']")
      .forEach((el) => el.addEventListener("change", (event) => this.#onToggleGlobal(event)));

    // Settings Panel Actions
    const settingsPanel = this.element.querySelector(".mta-settings-panel");
    if (settingsPanel) {
      settingsPanel.querySelector("[data-action='save-settings']")
        ?.addEventListener("click", (event) => this.#onSaveSettings(event));

      settingsPanel.querySelector("[data-action='delete-image']")
        ?.addEventListener("click", (event) => this.#onDeleteImage(event));

      settingsPanel.querySelector("[data-action='browse-file']")
        ?.addEventListener("click", (event) => this.#onBrowseFile(event));

      settingsPanel.querySelectorAll("input[type='range']").forEach(input => {
        input.addEventListener("input", (e) => {
          const span = e.target.nextElementSibling;
          if (span) span.textContent = e.target.value;
        });
      });
    }

    this.element.addEventListener("dragover", (event) => event.preventDefault());
    this.element.addEventListener("drop", (event) => this.#onDrop(event));
  }

  async #onDrop(event) {
    event.preventDefault();

    const section = event.target.closest("[data-image-type]");
    const imageType = section?.dataset.imageType || IMAGE_TYPES.TOKEN;

    // 1. Handle OS Files
    if (event.dataTransfer.files.length > 0) {
      for (const file of event.dataTransfer.files) {
        if (!file.type.startsWith("image/")) continue;
        const path = await uploadFileToActorFolder(file, this.actor);
        if (path) await this.#addImage(path, imageType);
      }
      return;
    }

    // 2. Handle Foundry Data (JSON)
    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch (err) {
      return;
    }

    if (!data) return;

    // Handle standard Foundry drops
    const src = data.src || data.texture?.src;
    if (src) {
      await this.#addImage(src, imageType);
    }
  }

  async #onAddImage(event) {
    const imageType = event.currentTarget.dataset.imageType;
    await this.#addImage("icons/svg/mystery-man.svg", imageType);
  }

  async #addImage(src, imageType) {
    const data = getActorModuleData(this.actor);
    const list = imageType === IMAGE_TYPES.TOKEN ? data.tokenImages : data.portraitImages;

    if (list.length >= IMAGE_LIMIT) {
      ui.notifications.warn(`Limit of ${IMAGE_LIMIT} images reached.`);
      return;
    }

    const newImage = {
      id: foundry.utils.randomID(),
      src: src,
      sort: list.length,
      isDefault: list.length === 0,
      autoEnable: {
        wounded: false,
        woundedPercent: 50,
        die: false
      },
      customScript: "",
      dynamicRing: {
        enabled: false,
        scaleCorrection: 1,
        ringColor: "#000000",
        backgroundColor: "#000000"
      }
    };

    list.push(newImage);
    await setActorModuleData(this.actor, data);

    // Automatically open settings for the new image
    this.activeSettings = { index: list.length - 1, imageType };
    this.render();
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

    // Don't full re-render if selecting, maybe just toggle active class?
    // But for now full render is safer to update UI state
    this.render();
  }

  async #onOpenSettings(event) {
    event.stopPropagation();
    const card = event.currentTarget.closest("[data-image-id]");
    if (!card) return;

    const imageType = card.dataset.imageType;
    const index = Number(card.dataset.index ?? 0);

    this.activeSettings = { index, imageType };
    this.render();
  }

  async #onSaveSettings(event) {
    if (!this.activeSettings) return;

    const panel = this.element.querySelector(".mta-settings-panel");
    const { index, imageType } = this.activeSettings;
    const data = getActorModuleData(this.actor);
    const list = imageType === IMAGE_TYPES.TOKEN ? data.tokenImages : data.portraitImages;

    // Harvest data manually
    const src = panel.querySelector("[name='src']").value;
    const isDefault = panel.querySelector("[name='isDefault']").checked;

    const autoEnable = {
      wounded: panel.querySelector("[name='autoEnable.wounded']").checked,
      woundedPercent: Number(panel.querySelector("[name='autoEnable.woundedPercent']").value),
      die: panel.querySelector("[name='autoEnable.die']").checked
    };

    const image = list[index];
    image.src = src;
    image.isDefault = isDefault;
    image.autoEnable = autoEnable;

    if (imageType === IMAGE_TYPES.TOKEN) {
      image.dynamicRing = {
        enabled: panel.querySelector("[name='dynamicRing.enabled']").checked,
        scaleCorrection: Number(panel.querySelector("[name='dynamicRing.scaleCorrection']").value),
        ringColor: panel.querySelector("[name='dynamicRing.ringColor']").value,
        backgroundColor: panel.querySelector("[name='dynamicRing.backgroundColor']").value
      };
    }

    // Ensure only one default? Logic implies "isDefault" means use this one if no other conditions met.
    // If multiple defaults, first one wins typically.

    await setActorModuleData(this.actor, data);
    ui.notifications.info("Settings saved.");
    this.render();
  }

  async #onDeleteImage(event) {
    if (!this.activeSettings) return;

    const confirm = await Dialog.confirm({
      title: "Delete Image?",
      content: "<p>Are you sure you want to delete this image configuration?</p>",
      defaultYes: false
    });

    if (!confirm) return;

    const { index, imageType } = this.activeSettings;
    const data = getActorModuleData(this.actor);
    const list = imageType === IMAGE_TYPES.TOKEN ? data.tokenImages : data.portraitImages;

    list.splice(index, 1);
    await setActorModuleData(this.actor, data);

    this.activeSettings = null;
    this.render();
  }

  async #onBrowseFile(event) {
    const input = event.currentTarget.previousElementSibling;
    const current = input.value;

    const picker = new FilePicker({
      type: "image",
      current: current,
      callback: (path) => {
        input.value = path;
      }
    });
    picker.browse(current);
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

    this.render();
  }

  async #onToggleGlobal(event) {
    const checkbox = event.currentTarget;
    const name = checkbox.name; // tokenRandom, portraitRandom, autoRotate
    const checked = checkbox.checked;

    const data = getActorModuleData(this.actor);

    // Map name to property
    if (name === "tokenRandom") data.global.tokenRandom = checked;
    else if (name === "portraitRandom") data.global.portraitRandom = checked;
    else if (name === "autoRotate") data.global.autoRotate = checked;

    await setActorModuleData(this.actor, data);
    this.render();
  }
}
