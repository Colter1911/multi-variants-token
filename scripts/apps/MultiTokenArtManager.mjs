import { IMAGE_LIMIT, IMAGE_TYPES, MODULE_ID, TOKEN_FLAG_KEYS, DEBUG_VERSION } from "../constants.mjs";
import { getActorModuleData, setActorModuleData } from "../utils/flag-utils.mjs";
import { uploadFileToActorFolder } from "../utils/file-utils.mjs";
import { pickRandomImage, sortImagesByOrder } from "../logic/RandomMode.mjs";
import { applyTokenImageById, applyPortraitById } from "../logic/AutoActivation.mjs";
import { applyAutoRotate } from "../logic/AutoRotate.mjs";
import { resolveHpData } from "../utils/hp-resolver.mjs";
import { AutoTokenService } from "../logic/AutoTokenService.mjs";
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
      height: "auto"
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

    // Clipboard Paste Support
    this._pasteHandler = this.#onPaste.bind(this);
    this._activePasteZone = null;
    this._pasteListenerAttached = false;
  }

  async close(options = {}) {
    window.removeEventListener("paste", this._pasteHandler);
    this._pasteListenerAttached = false;
    return super.close(options);
  }

  async _prepareContext() {
    const data = getActorModuleData(this.actor);
    let changed = false;

    // 1. Initialize default Token Image if empty
    if (!data.tokenImages || data.tokenImages.length === 0) {
      // Use current token texture or prototype
      const defaultSrc = this.tokenDocument?.texture?.src ?? this.actor.prototypeToken?.texture?.src ?? "icons/svg/mystery-man.svg";

      // Sync initial Dynamic Ring settings from Token Document
      const ringData = this.tokenDocument?.ring ?? {};
      const initialRing = {
        enabled: ringData.enabled ?? false,
        scaleCorrection: 1, // Default to 1 as requested previously
        ringColor: ringData.colors?.ring ? PIXI.utils.hex2string(ringData.colors.ring) : "#ffffff",
        backgroundColor: ringData.colors?.background ? PIXI.utils.hex2string(ringData.colors.background) : "#000000"
      };

      data.tokenImages = [{
        id: foundry.utils.randomID(),
        src: defaultSrc,
        sort: 0,
        isDefault: true,
        autoEnable: { enabled: false, wounded: false, woundedPercent: 50, die: false },
        customScript: "",
        dynamicRing: initialRing
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
        autoEnable: { enabled: false, wounded: false, woundedPercent: 50, die: false },
        customScript: "",
        dynamicRing: { enabled: false, scaleCorrection: 1, ringColor: "#ffffff", backgroundColor: "#000000" }
      }];
      changed = true;
    }

    if (changed) {
      await setActorModuleData(this.actor, data);
      // data is now updated, proceed with it
    }

    const tokenImages = sortImagesByOrder(data.tokenImages ?? []);
    const portraitImages = sortImagesByOrder(data.portraitImages ?? []);

    // Нормализация: добавляем autoEnable.enabled если не задано (для обратной совместимости)
    const normalizeImage = (image) => {
      if (!image.autoEnable) {
        image.autoEnable = { enabled: false, wounded: false, woundedPercent: 50, die: false };
      } else if (image.autoEnable.enabled === undefined) {
        image.autoEnable.enabled = false;
      }
      return image;
    };

    tokenImages.forEach(normalizeImage);
    portraitImages.forEach(normalizeImage);

    let activeTokenImageId = this.tokenDocument?.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_TOKEN_IMAGE_ID);
    let activePortraitImageId = this.tokenDocument?.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_PORTRAIT_IMAGE_ID);

    // Fallback: If no flag is set, try to match the current actor image
    if (!activePortraitImageId && this.actor.img) {
      const match = portraitImages.find(i => i.src === this.actor.img);
      if (match) activePortraitImageId = match.id;
    }

    // Fallback: If no flag is set, try to match the current token texture
    // (This might help if the token was changed externally or first load)
    if (!activeTokenImageId && this.tokenDocument?.texture?.src) {
      const match = tokenImages.find(i => i.src === this.tokenDocument.texture.src);
      if (match) activeTokenImageId = match.id;
    }

    const tokenCards = tokenImages.map((image, idx) => ({
      ...image,
      idx,
      imageType: IMAGE_TYPES.TOKEN,
      active: image.id === activeTokenImageId,
      isEditing: this.activeSettings?.imageType === IMAGE_TYPES.TOKEN && this.activeSettings?.index === idx
    }));

    const portraitCards = portraitImages.map((image, idx) => ({
      ...image,
      idx,
      imageType: IMAGE_TYPES.PORTRAIT,
      active: image.id === activePortraitImageId,
      isEditing: this.activeSettings?.imageType === IMAGE_TYPES.PORTRAIT && this.activeSettings?.index === idx
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
      activeSettings: activeSettingsData,
      debugVersion: DEBUG_VERSION
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    // Handle multiple actions on one element (e.g. "select-image open-settings")
    this.element.querySelectorAll("[data-action]").forEach((el) => {
      const actions = el.dataset.action.split(" ");
      el.addEventListener("click", async (event) => {
        for (const action of actions) {
          if (action === "select-image") await this.#onSelectImage(event);
          else if (action === "open-settings") await this.#onOpenSettings(event);
          else if (action === "delete-from-card") await this.#onDeleteFromCard(event);
          else if (action === "refresh-random") await this.#onRefreshRandom(event);
          else if (action === "add-image") await this.#onAddImage(event);
          else if (action === "toggle-global") await this.#onToggleGlobal(event);
          else if (action === "delete-image") await this.#onDeleteImage(event);
          else if (action === "save-settings") await this.#onSaveSettings(event);
          else if (action === "browse-file") await this.#onBrowseFile(event);
          else if (action === "create-token") await this.#onCreateToken(event);
        }
      });
    });

    // ПКМ на картинке открывает settings
    this.element.querySelectorAll(".mta-image-card").forEach((card) => {
      card.addEventListener("contextmenu", async (event) => {
        event.preventDefault();
        await this.#onOpenSettings(event);
      });
    });

    // Settings Panel Actions
    const settingsPanel = this.element.querySelector(".mta-settings-panel");
    if (settingsPanel) {
      // AutoEnable toggle handler - динамически включает/выключает Wounded и Die поля
      const autoEnableCheckbox = settingsPanel.querySelector("[name='autoEnable.enabled']");
      if (autoEnableCheckbox) {
        autoEnableCheckbox.addEventListener("change", (e) => {
          const enabled = e.target.checked;
          const woundedCheckbox = settingsPanel.querySelector("[name='autoEnable.wounded']");
          const woundedPercent = settingsPanel.querySelector("[name='autoEnable.woundedPercent']");
          const dieCheckbox = settingsPanel.querySelector("[name='autoEnable.die']");

          if (woundedCheckbox) woundedCheckbox.disabled = !enabled;
          if (woundedPercent) woundedPercent.disabled = !enabled;
          if (dieCheckbox) dieCheckbox.disabled = !enabled;
        });
      }

      settingsPanel.querySelectorAll("input[type='range']").forEach(input => {
        input.addEventListener("input", (e) => {
          const valueSpan = e.target.parentElement.querySelector(".range-value");
          if (valueSpan) valueSpan.textContent = e.target.value;
        });
      });
    }

    // Drag & Drop Visualization + Clipboard Zone Tracking
    const sections = this.element.querySelectorAll(".mta-section[data-image-type]");
    sections.forEach(section => {
      // Paste Zone Tracking
      section.addEventListener("mouseenter", () => {
        this._activePasteZone = section.dataset.imageType;
        // Optional: Hint?
      });
      section.addEventListener("mouseleave", () => {
        if (this._activePasteZone === section.dataset.imageType) {
          this._activePasteZone = null;
        }
      });

      // Drag & Drop
      section.addEventListener("dragenter", (e) => {
        e.preventDefault();
        section.classList.add("mta-drop-zone-active");
      });

      section.addEventListener("dragleave", (e) => {
        if (e.target === section) {
          section.classList.remove("mta-drop-zone-active");
        }
      });

      section.addEventListener("drop", (e) => {
        section.classList.remove("mta-drop-zone-active");
      });
    });

    // Prevent duplicate listeners on the root element
    if (!this._dropListenersAttached) {
      this.element.addEventListener("dragover", (event) => event.preventDefault());
      this.element.addEventListener("drop", (event) => this.#onDrop(event));
      this._dropListenersAttached = true;
    }

    // Clipboard Listener
    if (!this._pasteListenerAttached) {
      window.addEventListener("paste", this._pasteHandler);
      this._pasteListenerAttached = true;
    }
  }

  async #onPaste(event) {
    if (!this._activePasteZone) return;
    if (event.defaultPrevented) return;

    const items = (event.clipboardData || event.originalEvent.clipboardData).items;
    let foundImage = false;

    for (const item of items) {
      if (item.type.indexOf("image") === 0) {
        foundImage = true;
        event.preventDefault();
        const blob = item.getAsFile();
        const reader = new FileReader();

        reader.onload = async (event) => {
          // We need a proper File object with a name for upload
          // Generate a timestamped name
          const ext = blob.type.split("/")[1] || "png";
          const fileName = `pasted_image_${Date.now()}.${ext}`;
          const file = new File([blob], fileName, { type: blob.type });

          const path = await uploadFileToActorFolder(file, this.actor);
          if (path) {
            await this.#addImage(path, this._activePasteZone);
            ui.notifications.info(`Pasted image added to ${this._activePasteZone === IMAGE_TYPES.TOKEN ? "Token" : "Portrait"} list.`);
          }
        };
        reader.readAsArrayBuffer(blob); // Trigger the read
        // Actually, uploadFileToActorFolder takes a File object directly, no need to read it first unless for preview
        // but wait, the reader logic above was pure boilerplate. Let's simplify.
      }
    }

    if (foundImage) return;

    // Handle text paste (URLs)?
    const pastedText = event.clipboardData.getData("text/plain");
    if (pastedText && (pastedText.startsWith("http") || pastedText.match(/\.(jpg|jpeg|png|webp|gif|svg)$/i))) {
      event.preventDefault();
      await this.#addImage(pastedText, this._activePasteZone);
      ui.notifications.info(`Pasted URL added to ${this._activePasteZone === IMAGE_TYPES.TOKEN ? "Token" : "Portrait"} list.`);
    }
  }
  async #onDrop(event) {
    event.preventDefault();

    const section = event.target.closest("[data-image-type]");
    const imageType = section?.dataset.imageType || IMAGE_TYPES.TOKEN;

    // Remove drop zone highlight
    section?.classList.remove("mta-drop-zone-active");

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

    // Check for duplicates (But allow mystery-man placeholder to be duplicated)
    if (src !== "icons/svg/mystery-man.svg" && list.some(img => img.src === src)) {
      ui.notifications.warn("This image is already in the list.");
      return;
    }

    const newImage = {
      id: foundry.utils.randomID(),
      src: src,
      scaleX: this.tokenDocument?.texture.scaleX ?? 1,
      scaleY: this.tokenDocument?.texture.scaleY ?? 1,
      sort: list.length,
      isDefault: list.length === 0,
      autoEnable: {
        enabled: false,
        wounded: false,
        woundedPercent: 50,
        die: false
      },
      customScript: "",
      dynamicRing: {
        enabled: false,
        scaleCorrection: 1,
        ringColor: "#ffffff",
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
    await this.render();

    // Добавляем glow эффект к settings panel
    const settingsPanel = this.element.querySelector(".mta-settings-panel");
    if (settingsPanel) {
      settingsPanel.classList.add("mta-settings-glow");
      setTimeout(() => {
        settingsPanel.classList.remove("mta-settings-glow");
      }, 600);
    }
  }

  async #onDeleteFromCard(event) {
    event.stopPropagation();
    const card = event.currentTarget.closest("[data-image-id]");
    if (!card) return;

    const imageType = card.dataset.imageType;
    const index = Number(card.dataset.index ?? 0);

    const confirm = await Dialog.confirm({
      title: "Delete Image?",
      content: "<p>Are you sure you want to delete this image configuration?</p>",
      defaultYes: false
    });

    if (!confirm) return;

    const data = getActorModuleData(this.actor);
    const list = imageType === IMAGE_TYPES.TOKEN ? data.tokenImages : data.portraitImages;

    list.splice(index, 1);
    await setActorModuleData(this.actor, data);

    if (this.activeSettings?.index === index && this.activeSettings?.imageType === imageType) {
      this.activeSettings = null;
    }

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
      enabled: panel.querySelector("[name='autoEnable.enabled']")?.checked || false,
      wounded: panel.querySelector("[name='autoEnable.wounded']")?.checked || false,
      woundedPercent: Number(panel.querySelector("[name='autoEnable.woundedPercent']")?.value || 50),
      die: panel.querySelector("[name='autoEnable.die']")?.checked || false
    };

    console.log("[MTA] Saving autoEnable:", autoEnable);

    const image = list[index];
    image.src = src;
    image.scaleX = Number(panel.querySelector("[name='scaleX']")?.value ?? 1);
    image.scaleY = Number(panel.querySelector("[name='scaleY']")?.value ?? 1);
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

    // Ensure only one default
    if (isDefault) {
      list.forEach((img, idx) => {
        if (idx !== index) img.isDefault = false;
      });
    }

    await setActorModuleData(this.actor, data);
    ui.notifications.info("Settings saved.");

    // Auto-update if this image is currently active
    if (imageType === IMAGE_TYPES.TOKEN) {
      const activeId = this.tokenDocument.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_TOKEN_IMAGE_ID);
      if (activeId === image.id) {
        await applyTokenImageById({
          actor: this.actor,
          tokenDocument: this.tokenDocument,
          imageObject: image // Pass the updated object directly to avoid race conditions
        });
      }
    } else {
      const activeId = this.tokenDocument.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_PORTRAIT_IMAGE_ID);
      if (activeId === image.id) {
        await applyPortraitById({
          actor: this.actor,
          tokenDocument: this.tokenDocument,
          imageId: image.id
        });
      }
    }

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

  async #onCreateToken(event) {
    if (!this.activeSettings) return;

    const { index, imageType } = this.activeSettings;
    if (imageType !== IMAGE_TYPES.TOKEN) {
      ui.notifications.warn("Create Token доступен только для Token-изображений.");
      return;
    }

    const data = getActorModuleData(this.actor);
    const list = data.tokenImages;
    const image = list[index];
    if (!image) return;

    // Получаем src из панели (может быть изменён пользователем, но ещё не сохранён)
    const panel = this.element.querySelector(".mta-settings-panel");
    const srcInput = panel?.querySelector("[name='src']");
    const src = srcInput?.value || image.src;

    if (!src || src === "icons/svg/mystery-man.svg") {
      ui.notifications.warn("Сначала задайте изображение для обработки.");
      return;
    }

    ui.notifications.info("🎭 Создание токена... Подождите.");

    try {
      const service = AutoTokenService.instance();
      const { blob, faceCoordinates } = await service.createTokenBlob(src, 2.5);

      if (!blob) {
        ui.notifications.error("Не удалось создать токен.");
        return;
      }

      // Формируем безопасное имя файла
      let rawBaseName = src.split("/").pop()?.replace(/\.[^.]+$/, "") || "token";
      try {
        rawBaseName = decodeURIComponent(rawBaseName);
      } catch (e) {
        // Игнорируем ошибки декодирования
      }

      // Slugify для безопасности (удаляет спецсимволы, пробелы и т.д.)
      const baseName = rawBaseName.slugify({ strict: true }) || "token";
      const fileName = `${baseName}_token.webp`;
      const file = new File([blob], fileName, { type: "image/webp" });

      // Загружаем в папку актора
      const uploadedPath = await uploadFileToActorFolder(file, this.actor);
      if (!uploadedPath) {
        ui.notifications.error("Ошибка загрузки файла токена.");
        return;
      }

      // Обновляем данные изображения
      image.src = uploadedPath;
      image.dynamicRing = {
        enabled: true,
        scaleCorrection: 1,
        ringColor: "#ffffff",
        backgroundColor: "#000000"
      };

      await setActorModuleData(this.actor, data);

      // Применяем изображение к токену
      await applyTokenImageById({ actor: this.actor, tokenDocument: this.tokenDocument, imageId: image.id });

      // Принудительное обновление текстуры на canvas (если нужно)
      const token = this.tokenDocument?.object;
      if (token) {
        token.renderFlags.set({ refreshMesh: true });
        token.draw();
      }

      console.log("[MTA AutoToken] Токен создан:", {
        path: uploadedPath,
        faceCoordinates,
        dynamicRing: image.dynamicRing
      });

      ui.notifications.info(`✅ Токен создан: ${fileName}`);
      this.render();
    } catch (err) {
      console.error("[MTA AutoToken] Ошибка:", err);
      ui.notifications.error(`Ошибка создания токена: ${err.message}`);
    }
  }
}
