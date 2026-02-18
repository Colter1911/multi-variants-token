import { IMAGE_LIMIT, IMAGE_TYPES, MODULE_ID, TOKEN_FLAG_KEYS } from "../constants.mjs";
import { getActorModuleData, setActorModuleData } from "../utils/flag-utils.mjs";
import { ensureActorDirectory, uploadFileToActorFolder } from "../utils/file-utils.mjs";
import { pickRandomImage, sortImagesByOrder } from "../logic/RandomMode.mjs";
import { applyTokenImageById, applyPortraitById, runAutoActivation } from "../logic/AutoActivation.mjs";
import { applyAutoRotate } from "../logic/AutoRotate.mjs";
import { resolveHpData } from "../utils/hp-resolver.mjs";
import { AutoTokenService } from "../logic/AutoTokenService.mjs";
import { SettingsPanel } from "./SettingsPanel.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const MANUAL_TOKEN_ZOOM_LIMITS = Object.freeze({ min: 0.1, max: 10 });

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
      width: 800,
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
    this._directoryEnsured = false;
    this._manualTokenDialog = null;

    // Clipboard Paste Support
    this._pasteHandler = this.#onPaste.bind(this);
    this._activePasteZone = null;
    this._pasteListenerAttached = false;

    // Internal card drag'n'drop state
    this._internalCardDrag = null;
    this._onRootDragOver = (event) => event.preventDefault();
    this._onRootDrop = (event) => this.#onDrop(event);

    this._moduleVersion = game.modules?.get(MODULE_ID)?.version ?? "0.0.0";
    this._renderVersion = this.#computeRenderVersion(this._moduleVersion);
  }

  async close(options = {}) {
    this._manualTokenDialog?.close();
    this._manualTokenDialog = null;
    window.removeEventListener("paste", this._pasteHandler);
    this._pasteListenerAttached = false;
    this._internalCardDrag = null;
    return super.close(options);
  }

  async _prepareContext() {
    this.#refreshVersionSnapshot();

    if (!this._directoryEnsured && this.actor) {
      await ensureActorDirectory(this.actor);
      this._directoryEnsured = true;
    }

    const data = getActorModuleData(this.actor);
    let changed = false;
    const activeTokenDocument = this.tokenDocument ?? this.actor?.prototypeToken ?? null;

    // 1. Initialize default Token Image if empty
    if (!data.tokenImages || data.tokenImages.length === 0) {
      // Use current token texture or prototype
      const defaultSrc = activeTokenDocument?.texture?.src ?? this.actor.prototypeToken?.texture?.src ?? "icons/svg/mystery-man.svg";

      // Sync initial Dynamic Ring settings from Token Document
      const ringData = activeTokenDocument?.ring ?? {};
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
    if (!activeTokenImageId && activeTokenDocument?.texture?.src) {
      const match = tokenImages.find(i => i.src === activeTokenDocument.texture.src);
      if (match) activeTokenImageId = match.id;
    }

    const tokenCards = tokenImages.map((image, idx) => ({
      ...image,
      idx,
      order: idx + 1,
      imageType: IMAGE_TYPES.TOKEN,
      active: image.id === activeTokenImageId,
      isEditing: this.activeSettings?.imageType === IMAGE_TYPES.TOKEN && this.activeSettings?.index === idx
    }));

    const portraitCards = portraitImages.map((image, idx) => ({
      ...image,
      idx,
      order: idx + 1,
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
      hasTokenContext: !!this.tokenDocument,
      title: game.i18n.format("MTA.ManagerTitle", { name: this.actor?.name ?? "" }),
      global: data.global,
      tokenCards,
      portraitCards,
      activeSettings: activeSettingsData,
      debugVersion: this._renderVersion
    };
  }

  #computeRenderVersion(baseVersion) {
    const version = String(baseVersion ?? "0.0.0").trim() || "0.0.0";
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12);
    return `v${version}.${stamp}`;
  }

  #refreshVersionSnapshot() {
    this._moduleVersion = game.modules?.get(MODULE_ID)?.version ?? this._moduleVersion ?? "0.0.0";
    this._renderVersion = this.#computeRenderVersion(this._moduleVersion);
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
          else if (action === "create-token-for-all") await this.#onCreateTokenForAll(event);
          else if (action === "add-image") await this.#onAddImage(event);
          else if (action === "toggle-global") await this.#onToggleGlobal(event);
          else if (action === "delete-image") await this.#onDeleteImage(event);
          else if (action === "save-settings") await this.#onSaveSettings(event);
          else if (action === "browse-file") await this.#onBrowseFile(event);
          else if (action === "create-token") await this.#onCreateToken(event);
          else if (action === "create-manual-token") await this.#onCreateManualToken(event);
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

    // Internal drag'n'drop between image cards (within and across zones)
    this.element.querySelectorAll(".mta-image-card[data-image-id]").forEach((card) => {
      card.setAttribute("draggable", "true");

      const dragHandles = [
        card,
        card.querySelector(".mta-card-clickable"),
        card.querySelector("img")
      ].filter(Boolean);

      for (const handle of dragHandles) {
        handle.setAttribute?.("draggable", "true");

        handle.addEventListener("dragstart", (event) => {
          const cardEl = event.currentTarget.closest(".mta-image-card[data-image-id]");
          if (!cardEl) return;

          const payload = {
            type: "mta-image-card-drag",
            imageId: cardEl.dataset.imageId,
            imageType: cardEl.dataset.imageType
          };

          this._internalCardDrag = payload;
          cardEl.classList.add("mta-card-dragging");

          if (event.dataTransfer) {
            const raw = JSON.stringify(payload);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("application/mta-image-card-drag", raw);
            event.dataTransfer.setData("text/plain", raw);
          }
        });

        handle.addEventListener("dragend", () => {
          this._internalCardDrag = null;
          this.#clearDragVisualState();
        });
      }

      card.addEventListener("dragover", (event) => {
        if (!this._internalCardDrag) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      });

      card.addEventListener("dragenter", (event) => {
        if (!this._internalCardDrag) return;
        const cardEl = event.currentTarget.closest(".mta-image-card[data-image-id]");
        cardEl?.classList.add("mta-drop-target");
      });

      card.addEventListener("dragleave", (event) => {
        if (!this._internalCardDrag) return;
        const cardEl = event.currentTarget.closest(".mta-image-card[data-image-id]");
        if (!cardEl) return;
        const related = event.relatedTarget;
        if (related && cardEl.contains(related)) return;
        cardEl.classList.remove("mta-drop-target");
      });

      card.addEventListener("drop", () => {
        card.classList.remove("mta-drop-target");
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

    // Root-level drop listeners must be reattached on each render (DOM is recreated)
    this.element.removeEventListener("dragover", this._onRootDragOver);
    this.element.removeEventListener("drop", this._onRootDrop);
    this.element.addEventListener("dragover", this._onRootDragOver);
    this.element.addEventListener("drop", this._onRootDrop);

    // Clipboard Listener
    if (!this._pasteListenerAttached) {
      window.addEventListener("paste", this._pasteHandler);
      this._pasteListenerAttached = true;
    }

    this.#applyGridRowLimit(3);
  }

  #applyGridRowLimit(maxRows = 3) {
    const grids = this.element?.querySelectorAll(".mta-section .mta-grid");
    if (!grids?.length) return;

    for (const grid of grids) {
      grid.style.maxHeight = "";
      grid.classList.remove("mta-grid-scroll");

      const cards = Array.from(grid.querySelectorAll(".mta-image-card"));
      if (!cards.length) continue;

      const gridRect = grid.getBoundingClientRect();

      const rowTops = [];
      for (const card of cards) {
        const cardRect = card.getBoundingClientRect();
        const top = Math.round(cardRect.top - gridRect.top);
        if (!Number.isFinite(top)) continue;
        if (!rowTops.some((value) => Math.abs(value - top) <= 2)) {
          rowTops.push(top);
        }
      }

      rowTops.sort((a, b) => a - b);
      if (rowTops.length <= maxRows) continue;

      // Ограничиваем высоту до начала 4-го ряда: видим ровно 3 ряда, дальше скролл.
      const nextRowTop = rowTops[maxRows];
      const maxHeightPx = Math.max(0, Math.floor(nextRowTop - 1));

      if (Number.isFinite(maxHeightPx) && maxHeightPx > 0) {
        grid.style.maxHeight = `${maxHeightPx}px`;
        grid.classList.add("mta-grid-scroll");
      }
    }
  }

  #clearDragVisualState() {
    this.element?.querySelectorAll(".mta-card-dragging").forEach((el) => el.classList.remove("mta-card-dragging"));
    this.element?.querySelectorAll(".mta-drop-target").forEach((el) => el.classList.remove("mta-drop-target"));
    this.element?.querySelectorAll(".mta-section.mta-drop-zone-active").forEach((el) => el.classList.remove("mta-drop-zone-active"));
  }

  #getInternalDragPayload(event) {
    if (this._internalCardDrag?.type === "mta-image-card-drag") return this._internalCardDrag;

    const dataTransfer = event?.dataTransfer;
    if (!dataTransfer) return null;

    const raw = dataTransfer.getData("application/mta-image-card-drag") || dataTransfer.getData("text/plain");
    if (!raw) return null;

    try {
      const payload = JSON.parse(raw);
      if (payload?.type === "mta-image-card-drag" && payload?.imageId && payload?.imageType) {
        return payload;
      }
    } catch (_err) {
      // Not internal payload
    }

    return null;
  }

  #ensureSingleDefault(list, preferredId = null) {
    if (!Array.isArray(list) || list.length === 0) return;

    const hasPreferred = preferredId && list.some((img) => img.id === preferredId);
    const selectedId = hasPreferred
      ? preferredId
      : (list.find((img) => img.isDefault)?.id ?? list[0]?.id);

    list.forEach((img) => {
      img.isDefault = img.id === selectedId;
    });
  }

  #reindexImageList(list = []) {
    list.forEach((img, index) => {
      img.sort = index;
    });
  }

  async #handleInternalCardDrop({ targetImageType, targetCardId, payload }) {
    if (!payload?.imageId || !payload?.imageType) return false;

    const data = getActorModuleData(this.actor);
    data.tokenImages = sortImagesByOrder(data.tokenImages ?? []);
    data.portraitImages = sortImagesByOrder(data.portraitImages ?? []);

    const sourceList = payload.imageType === IMAGE_TYPES.TOKEN ? data.tokenImages : data.portraitImages;
    const targetList = targetImageType === IMAGE_TYPES.TOKEN ? data.tokenImages : data.portraitImages;

    if (!sourceList || !targetList) return false;

    const sourceIndex = sourceList.findIndex((img) => img.id === payload.imageId);
    if (sourceIndex < 0) return false;

    if (sourceList === targetList && targetCardId === payload.imageId) return true;

    const sourceDefaultId = sourceList.find((img) => img.isDefault)?.id ?? null;
    const targetDefaultId = targetList.find((img) => img.isDefault)?.id ?? null;

    let insertIndex = targetCardId
      ? targetList.findIndex((img) => img.id === targetCardId)
      : targetList.length;

    if (insertIndex < 0) insertIndex = targetList.length;

    if (sourceList === targetList) {
      const [movingImage] = sourceList.splice(sourceIndex, 1);
      if (!movingImage) return false;

      if (sourceIndex < insertIndex) {
        insertIndex -= 1;
      }

      insertIndex = Math.max(0, Math.min(insertIndex, targetList.length));
      targetList.splice(insertIndex, 0, movingImage);
      this.#ensureSingleDefault(sourceList, sourceDefaultId);
    } else {
      if (targetList.length >= IMAGE_LIMIT) {
        ui.notifications.warn(`Limit of ${IMAGE_LIMIT} images reached.`);
        return false;
      }

      const sourceImage = sourceList[sourceIndex];
      if (!sourceImage) return false;

      const copiedImage = foundry.utils.deepClone(sourceImage);
      copiedImage.id = foundry.utils.randomID();
      copiedImage.isDefault = false;

      insertIndex = Math.max(0, Math.min(insertIndex, targetList.length));
      targetList.splice(insertIndex, 0, copiedImage);

      this.#ensureSingleDefault(sourceList, sourceDefaultId);
      const targetPreferredDefault = targetDefaultId ?? (targetList.length === 1 ? copiedImage.id : null);
      this.#ensureSingleDefault(targetList, targetPreferredDefault);
    }

    this.#reindexImageList(data.tokenImages);
    this.#reindexImageList(data.portraitImages);

    this.activeSettings = null;
    await setActorModuleData(this.actor, data);
    this.render();
    return true;
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
    }
  }
  async #onDrop(event) {
    event.preventDefault();
    event.stopPropagation();

    const section = event.target.closest("[data-image-type]");
    const imageType = section?.dataset.imageType || IMAGE_TYPES.TOKEN;
    const targetCard = event.target.closest(".mta-image-card[data-image-id]");

    // Remove drop zone highlight
    section?.classList.remove("mta-drop-zone-active");

    // 0. Handle internal card reordering/moving first
    const internalPayload = this.#getInternalDragPayload(event);
    if (internalPayload) {
      await this.#handleInternalCardDrop({
        targetImageType: targetCard?.dataset?.imageType ?? imageType,
        targetCardId: targetCard?.dataset?.imageId ?? null,
        payload: internalPayload
      });

      this._internalCardDrag = null;
      this.#clearDragVisualState();

      // Defensive cleanup: some browsers/Foundry interactions can leave stale hover UI
      // after external token drag/drop or clone operations.
      const hoveredLayer = canvas?.tokens?.hover;
      if (hoveredLayer) {
        hoveredLayer.hover = false;
        hoveredLayer.renderFlags?.set?.({ refreshHover: true, refreshState: true });
      }

      const controlledTokens = canvas?.tokens?.controlled ?? [];
      for (const token of controlledTokens) {
        token.hover = false;
        token.renderFlags?.set?.({ refreshHover: true, refreshState: true });
      }

      return;
    }

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
    const activeTokenDocument = this.tokenDocument ?? this.actor?.prototypeToken ?? null;

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
      scaleX: activeTokenDocument?.texture?.scaleX ?? 1,
      scaleY: activeTokenDocument?.texture?.scaleY ?? 1,
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

    if (this.activeSettings?.imageType === imageType && this.activeSettings?.index === index) {
      this.activeSettings = null;
      await this.render();
      return;
    }

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
    const previousSrc = image.src;
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
      if (this.tokenDocument) {
        const activeId = this.tokenDocument.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_TOKEN_IMAGE_ID);
        if (activeId === image.id) {
          await applyTokenImageById({
            actor: this.actor,
            tokenDocument: this.tokenDocument,
            imageObject: image // Pass the updated object directly to avoid race conditions
          });
        }
      } else {
        const prototypeSrc = this.actor?.prototypeToken?.texture?.src;
        if (prototypeSrc === previousSrc || prototypeSrc === image.src) {
          await applyTokenImageById({
            actor: this.actor,
            tokenDocument: null,
            imageObject: image
          });
        }
      }
    } else {
      const actorImg = this.actor?.img;
      const activePortraitId = this.tokenDocument
        ? this.tokenDocument.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_PORTRAIT_IMAGE_ID)
        : (actorImg === previousSrc
          ? image.id
          : list.find((img) => img.src === actorImg)?.id);

      if (activePortraitId === image.id) {
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
    else if (name === "linkTokenPortrait") data.global.linkTokenPortrait = checked;
    else if (name === "autoRotate") data.global.autoRotate = checked;

    await setActorModuleData(this.actor, data);

    if (name === "linkTokenPortrait" && checked) {
      await runAutoActivation({ actor: this.actor, tokenDocument: this.tokenDocument });
    }

    this.render();
  }

  #resolveActiveImageSource() {
    if (!this.activeSettings) return null;

    const { index, imageType } = this.activeSettings;
    const data = getActorModuleData(this.actor);
    const list = imageType === IMAGE_TYPES.TOKEN ? data.tokenImages : data.portraitImages;
    const image = list?.[index];
    if (!image) return null;

    // Источник может быть изменён в форме, но ещё не сохранён в flags.
    const panel = this.element?.querySelector(".mta-settings-panel");
    const srcInput = panel?.querySelector("[name='src']");
    const src = String(srcInput?.value ?? image.src ?? "").trim();

    if (!src || src === "icons/svg/mystery-man.svg") {
      ui.notifications.warn(game.i18n.localize("MTA.SourceImageRequired"));
      return null;
    }

    return { index, imageType, src };
  }

  #buildGeneratedTokenFile(blob, src, { generationMode = "auto" } = {}) {
    let rawBaseName = src.split("/").pop()?.replace(/\.[^.]+$/, "") || "token";
    try {
      rawBaseName = decodeURIComponent(rawBaseName);
    } catch (_e) {
      // ignore decode errors
    }

    const baseName = rawBaseName.slugify({ strict: true }) || "token";
    const modeTag = generationMode === "manual" ? "manual" : "auto";
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    const nonce = (foundry.utils.randomID?.() ?? Math.random().toString(36).slice(2, 10)).slice(0, 8);
    const fileName = `${baseName}_token_${modeTag}_${stamp}_${nonce}.webp`;
    return new File([blob], fileName, { type: "image/webp" });
  }

  async #persistGeneratedTokenBlob({ blob, src, imageType, index, generationMode = "auto" }) {
    if (!blob) {
      ui.notifications.error(game.i18n.localize("MTA.TokenCreateFailed"));
      return null;
    }

    const file = this.#buildGeneratedTokenFile(blob, src, { generationMode });
    const uploadedPath = await uploadFileToActorFolder(file, this.actor);
    if (!uploadedPath) {
      ui.notifications.error(game.i18n.localize("MTA.TokenUploadFailed"));
      return null;
    }

    const data = getActorModuleData(this.actor);
    let targetTokenImage = null;

    if (imageType === IMAGE_TYPES.PORTRAIT) {
      const tokenList = sortImagesByOrder(data.tokenImages ?? []);
      if (tokenList.length >= IMAGE_LIMIT) {
        ui.notifications.warn(`Limit of ${IMAGE_LIMIT} images reached.`);
        return null;
      }

      const insertIndex = Math.min(Math.max(0, index), tokenList.length);
      const tokenImage = this.#buildGeneratedTokenImage(uploadedPath, insertIndex);
      tokenList.splice(insertIndex, 0, tokenImage);
      tokenList.forEach((tokenImageEntry, tokenIndex) => {
        tokenImageEntry.sort = tokenIndex;
      });

      if (!tokenList.some((tokenImageEntry) => tokenImageEntry?.isDefault) && tokenList[0]) {
        tokenList[0].isDefault = true;
      }

      data.tokenImages = tokenList;
      targetTokenImage = tokenImage;
    } else {
      const tokenList = data.tokenImages ?? [];
      const tokenImage = tokenList[index];
      if (!tokenImage) {
        ui.notifications.warn(game.i18n.localize("MTA.TokenTargetNotFound"));
        return null;
      }
      tokenImage.src = uploadedPath;
      targetTokenImage = tokenImage;
    }

    targetTokenImage.dynamicRing = {
      enabled: true,
      scaleCorrection: 1,
      ringColor: "#ffffff",
      backgroundColor: "#000000"
    };

    await setActorModuleData(this.actor, data);
    await applyTokenImageById({ actor: this.actor, tokenDocument: this.tokenDocument, imageId: targetTokenImage.id });
    this.#forceTokenTextureRefresh();

    return { uploadedPath, targetTokenImage };
  }

  #forceTokenTextureRefresh() {
    const token = this.tokenDocument?.object;
    if (!token) return;
    token.renderFlags.set({ refreshMesh: true });
    token.draw();
  }

  async #onCreateToken(event) {
    const sourceContext = this.#resolveActiveImageSource();
    if (!sourceContext) return;

    const { src, imageType, index } = sourceContext;

    try {
      const service = AutoTokenService.instance();
      const { blob, faceCoordinates } = await service.createTokenBlob(src, 2.5);
      const saved = await this.#persistGeneratedTokenBlob({
        blob,
        src,
        imageType,
        index,
        generationMode: "auto"
      });
      if (!saved) return;

      console.log("[MTA AutoToken] Токен создан:", {
        path: saved.uploadedPath,
        faceCoordinates,
        dynamicRing: saved.targetTokenImage?.dynamicRing
      });
      this.render();
    } catch (err) {
      console.error("[MTA AutoToken] Ошибка:", err);
      ui.notifications.error(`${game.i18n.localize("MTA.TokenCreateErrorPrefix")}: ${err.message}`);
    }
  }

  async #onCreateManualToken(event) {
    const sourceContext = this.#resolveActiveImageSource();
    if (!sourceContext) return;

    const { src, imageType, index } = sourceContext;

    try {
      const image = await this.#loadImageElement(src);
      await this.#openManualTokenDialog({ src, imageType, index, image });
    } catch (err) {
      console.error("[MTA ManualToken] Ошибка открытия окна:", err);
      ui.notifications.error(`${game.i18n.localize("MTA.TokenCreateErrorPrefix")}: ${err.message}`);
    }
  }

  async #openManualTokenDialog({ src, imageType, index, image }) {
    this._manualTokenDialog?.close();
    this._manualTokenDialog = null;

    const viewportWidth = Math.max(480, window.innerWidth || 1280);
    const viewportHeight = Math.max(360, window.innerHeight || 720);

    // Фиксированный размер окна (адаптивно только при маленьком экране).
    const DEFAULT_DIALOG_WIDTH = 1100;
    const DEFAULT_DIALOG_HEIGHT = 720;
    const width = Math.max(640, Math.min(DEFAULT_DIALOG_WIDTH, viewportWidth - 20));
    const height = Math.max(430, Math.min(DEFAULT_DIALOG_HEIGHT, viewportHeight - 20));

    const left = Math.max(8, Math.floor((viewportWidth - width) / 2));
    const top = Math.max(8, Math.floor((viewportHeight - height) / 2));

    const state = {
      src,
      imageType,
      index,
      image,
      zoom: 1,
      zoomMin: MANUAL_TOKEN_ZOOM_LIMITS.min,
      zoomMax: MANUAL_TOKEN_ZOOM_LIMITS.max,
      panX: 0,
      panY: 0,
      isPanning: false,
      panStart: null,
      hoverSource: {
        x: (image.naturalWidth || image.width) / 2,
        y: (image.naturalHeight || image.height) / 2
      },
      fixedSource: null,
      isFixed: false,
      selection: null,
      metrics: null,
      stageCanvas: null,
      previewCanvas: null,
      zoomValueEl: null,
      alphaStatusEl: null,
      alphaSnapRangeEl: null,
      alphaSnapValueEl: null,
      alphaToggleBtn: null,
      alphaApplyBtn: null,
      alphaUndoBtn: null,
      alphaClearBtn: null,
      edgeSnapEnabled: false,
      edgeSnapTolerance: 50,
      edgeMap: null,
      edgeGradX: null,
      edgeGradY: null,
      edgeColorData: null,
      edgeMapWidth: 0,
      edgeMapHeight: 0,
      edgeMapMean: 0,
      edgeMapStd: 0,
      edgeMapMax: 0,
      edgeMapP55: 0,
      edgeMapP70: 0,
      edgeMapP82: 0,
      edgeMapP92: 0,
      edgeSnapLastPoint: null,
      edgeSnapLatched: false,
      alphaDrawEnabled: false,
      alphaCurrentStroke: null,
      alphaCurrentStrokeMode: "add",
      alphaPendingPolygons: [],
      alphaAppliedPolygons: [],
      alphaMaskVersion: 0,
      alphaMaskAppliedVersion: -1,
      circleRadiusPx: 0,
      fixedCircleRadiusPx: null,
      fixedSelection: null,
      _stageSizeKey: "",
      cleanup: null,
      renderRafId: null,
      resizeObserver: null,
      initialRenderTimeout: null
    };

    const dialog = new Dialog({
      title: game.i18n.localize("MTA.ManualTokenDialogTitle"),
      content: this.#buildManualTokenDialogContent(),
      buttons: {},
      render: (html) => {
        const root = this.#resolveDialogRoot(html, dialog);
        this.#bindManualTokenDialog(root, dialog, state);
      },
      close: () => {
        if (typeof state.cleanup === "function") state.cleanup();
        if (this._manualTokenDialog === dialog) this._manualTokenDialog = null;
      }
    }, {
      classes: [MODULE_ID, "mta-manual-token-window"],
      width,
      height,
      top,
      left,
      resizable: false
    });

    this._manualTokenDialog = dialog;
    dialog.render(true);
  }

  #resolveDialogRoot(html, dialog) {
    const direct = html?.[0] ?? html;
    if (direct?.querySelector) return direct;
    if (dialog?.element?.querySelector) return dialog.element;
    return document.querySelector(`.${MODULE_ID}.mta-manual-token-window`) ?? null;
  }

  #buildManualTokenDialogContent() {
    const previewTitle = game.i18n.localize("MTA.ManualTokenPreviewTitle");
    const alphaEditorTitle = game.i18n.localize("MTA.ManualAlphaEditorTitle");
    const drawToggleLabel = game.i18n.localize("MTA.ManualAlphaDrawToggle");
    const applyAlphaLabel = game.i18n.localize("MTA.ManualAlphaApply");
    const undoAlphaLabel = game.i18n.localize("MTA.ManualAlphaUndo");
    const clearAlphaLabel = game.i18n.localize("MTA.ManualAlphaClear");
    const alphaStatusIdle = game.i18n.localize("MTA.ManualAlphaStatusIdle");
    const snapLabel = game.i18n.localize("MTA.ManualAlphaSnapLabel");
    const snapHint = game.i18n.localize("MTA.ManualAlphaSnapHint");
    const createLabel = game.i18n.localize("MTA.CreateToken");
    const cancelLabel = game.i18n.localize("MTA.Cancel");
    const hint = game.i18n.localize("MTA.ManualTokenHint");

    return `
      <section class="mta-manual-token-dialog">
        <div class="mta-manual-token-layout">
          <div class="mta-manual-token-stage-shell">
            <canvas class="mta-manual-stage-canvas"></canvas>
            <div class="mta-manual-zoom-badge"><span data-field="zoom-value">1.00x</span></div>
          </div>

          <aside class="mta-manual-token-sidebar">
            <h4>${previewTitle}</h4>
            <div class="mta-manual-preview-shell">
              <canvas class="mta-manual-preview-canvas"></canvas>
            </div>

            <div class="mta-manual-alpha-tools">
              <h5>${alphaEditorTitle}</h5>
              <div class="mta-manual-alpha-actions">
                <button type="button" data-action="manual-alpha-toggle">${drawToggleLabel}</button>
                <button type="button" data-action="manual-alpha-apply" disabled>${applyAlphaLabel}</button>
              </div>
              <div class="mta-manual-alpha-actions mta-manual-alpha-actions--secondary">
                <button type="button" data-action="manual-alpha-undo" disabled>${undoAlphaLabel}</button>
                <button type="button" data-action="manual-alpha-clear" disabled>${clearAlphaLabel}</button>
              </div>
              <div class="mta-manual-alpha-snap">
                <label for="mta-manual-alpha-snap-range">${snapLabel}: <span data-field="manual-alpha-snap-value">50</span></label>
                <input id="mta-manual-alpha-snap-range" type="range" min="0" max="100" step="1" value="50" data-field="manual-alpha-snap-range" />
                <small>${snapHint}</small>
              </div>
              <p class="mta-manual-alpha-status" data-field="manual-alpha-status">${alphaStatusIdle}</p>
            </div>

            <div class="mta-manual-sidebar-actions">
              <button type="button" class="mta-button-primary" data-action="manual-create-token">${createLabel}</button>
              <button type="button" data-action="manual-cancel">${cancelLabel}</button>
            </div>
          </aside>
        </div>

        <p class="mta-manual-token-hint">${hint}</p>
      </section>
    `;
  }

  #bindManualTokenDialog(root, dialog, state) {
    if (!root) return;

    const stageShell = root.querySelector(".mta-manual-token-stage-shell");
    const stageCanvas = root.querySelector(".mta-manual-stage-canvas");
    const previewCanvas = root.querySelector(".mta-manual-preview-canvas");
    const zoomValueEl = root.querySelector("[data-field='zoom-value']");
    const alphaStatusEl = root.querySelector("[data-field='manual-alpha-status']");
    const alphaSnapRangeEl = root.querySelector("[data-field='manual-alpha-snap-range']");
    const alphaSnapValueEl = root.querySelector("[data-field='manual-alpha-snap-value']");
    const alphaToggleBtn = root.querySelector("[data-action='manual-alpha-toggle']");
    const alphaApplyBtn = root.querySelector("[data-action='manual-alpha-apply']");
    const alphaUndoBtn = root.querySelector("[data-action='manual-alpha-undo']");
    const alphaClearBtn = root.querySelector("[data-action='manual-alpha-clear']");
    const createBtn = root.querySelector("[data-action='manual-create-token']");
    const cancelBtn = root.querySelector("[data-action='manual-cancel']");

    if (!stageCanvas || !previewCanvas || !createBtn || !cancelBtn || !alphaToggleBtn || !alphaApplyBtn || !alphaUndoBtn || !alphaClearBtn || !alphaStatusEl || !alphaSnapRangeEl || !alphaSnapValueEl) {
      return;
    }

    state.stageCanvas = stageCanvas;
    state.previewCanvas = previewCanvas;
    state.zoomValueEl = zoomValueEl;
    state.alphaStatusEl = alphaStatusEl;
    state.alphaSnapRangeEl = alphaSnapRangeEl;
    state.alphaSnapValueEl = alphaSnapValueEl;
    state.alphaToggleBtn = alphaToggleBtn;
    state.alphaApplyBtn = alphaApplyBtn;
    state.alphaUndoBtn = alphaUndoBtn;
    state.alphaClearBtn = alphaClearBtn;

    const updateSnapUi = () => {
      if (state.alphaSnapRangeEl) {
        state.alphaSnapRangeEl.value = String(state.edgeSnapTolerance ?? 50);
      }
      if (state.alphaSnapValueEl) {
        state.alphaSnapValueEl.textContent = String(Math.round(state.edgeSnapTolerance ?? 50));
      }
    };

    const ensureEdgeMap = () => {
      const image = state.image;
      const imageWidth = image.naturalWidth || image.width;
      const imageHeight = image.naturalHeight || image.height;

      if (
        state.edgeMap
        && state.edgeGradX
        && state.edgeGradY
        && state.edgeColorData
        && state.edgeMapWidth === imageWidth
        && state.edgeMapHeight === imageHeight
      ) {
        return;
      }

      const edgeCanvas = document.createElement("canvas");
      edgeCanvas.width = imageWidth;
      edgeCanvas.height = imageHeight;
      const edgeCtx = edgeCanvas.getContext("2d", { willReadFrequently: true });
      if (!edgeCtx) {
        state.edgeMap = null;
        state.edgeGradX = null;
        state.edgeGradY = null;
        state.edgeColorData = null;
        state.edgeMapWidth = 0;
        state.edgeMapHeight = 0;
        state.edgeMapMean = 0;
        state.edgeMapStd = 0;
        state.edgeMapMax = 0;
        state.edgeMapP55 = 0;
        state.edgeMapP70 = 0;
        state.edgeMapP82 = 0;
        state.edgeMapP92 = 0;
        return;
      }

      edgeCtx.drawImage(image, 0, 0, imageWidth, imageHeight);
      const src = edgeCtx.getImageData(0, 0, imageWidth, imageHeight);
      const srcData = src.data;
      const pixelCount = imageWidth * imageHeight;

      const luminance = new Float32Array(pixelCount);
      for (let i = 0; i < pixelCount; i++) {
        const base = i * 4;
        luminance[i] = (0.299 * srcData[base]) + (0.587 * srcData[base + 1]) + (0.114 * srcData[base + 2]);
      }

      const blurAxis = (input, width, height, horizontal) => {
        const output = new Float32Array(input.length);
        const kernel = [1, 4, 6, 4, 1];
        const kernelWeight = 16;

        if (horizontal) {
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              let sum = 0;
              for (let k = -2; k <= 2; k++) {
                const sx = Math.max(0, Math.min(width - 1, x + k));
                sum += input[(y * width) + sx] * kernel[k + 2];
              }
              output[(y * width) + x] = sum / kernelWeight;
            }
          }
        } else {
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              let sum = 0;
              for (let k = -2; k <= 2; k++) {
                const sy = Math.max(0, Math.min(height - 1, y + k));
                sum += input[(sy * width) + x] * kernel[k + 2];
              }
              output[(y * width) + x] = sum / kernelWeight;
            }
          }
        }

        return output;
      };

      const luminanceBlurred = blurAxis(blurAxis(luminance, imageWidth, imageHeight, true), imageWidth, imageHeight, false);
      const edgeMap = new Float32Array(pixelCount);
      const gradXMap = new Float32Array(pixelCount);
      const gradYMap = new Float32Array(pixelCount);
      let sum = 0;
      let sumSq = 0;
      let count = 0;
      let maxMagnitude = 0;

      const lumAt = (x, y) => luminanceBlurred[(y * imageWidth) + x];
      const channelAt = (x, y, channel) => srcData[(((y * imageWidth) + x) * 4) + channel];

      for (let y = 1; y < (imageHeight - 1); y++) {
        for (let x = 1; x < (imageWidth - 1); x++) {
          const tl = lumAt(x - 1, y - 1);
          const tc = lumAt(x, y - 1);
          const tr = lumAt(x + 1, y - 1);
          const ml = lumAt(x - 1, y);
          const mr = lumAt(x + 1, y);
          const bl = lumAt(x - 1, y + 1);
          const bc = lumAt(x, y + 1);
          const br = lumAt(x + 1, y + 1);

          const gx = (-1 * tl) + (1 * tr)
            + (-2 * ml) + (2 * mr)
            + (-1 * bl) + (1 * br);
          const gy = (-1 * tl) + (-2 * tc) + (-1 * tr)
            + (1 * bl) + (2 * bc) + (1 * br);

          const rDx = channelAt(x + 1, y, 0) - channelAt(x - 1, y, 0);
          const rDy = channelAt(x, y + 1, 0) - channelAt(x, y - 1, 0);
          const gDx = channelAt(x + 1, y, 1) - channelAt(x - 1, y, 1);
          const gDy = channelAt(x, y + 1, 1) - channelAt(x, y - 1, 1);
          const bDx = channelAt(x + 1, y, 2) - channelAt(x - 1, y, 2);
          const bDy = channelAt(x, y + 1, 2) - channelAt(x, y - 1, 2);

          const lumMagnitude = Math.sqrt((gx * gx) + (gy * gy));
          const colorMagnitude = Math.sqrt(
            (rDx * rDx) + (rDy * rDy)
            + (gDx * gDx) + (gDy * gDy)
            + (bDx * bDx) + (bDy * bDy)
          ) / Math.sqrt(3);

          const magnitude = (lumMagnitude * 0.52) + (colorMagnitude * 0.48);
          const idx = (y * imageWidth) + x;
          edgeMap[idx] = magnitude;
          gradXMap[idx] = gx;
          gradYMap[idx] = gy;
          sum += magnitude;
          sumSq += (magnitude * magnitude);
          count += 1;
          if (magnitude > maxMagnitude) maxMagnitude = magnitude;
        }
      }

      const mean = count > 0 ? (sum / count) : 0;
      const variance = count > 0 ? Math.max(0, (sumSq / count) - (mean * mean)) : 0;
      const std = Math.sqrt(variance);

      const histogram = new Uint32Array(512);
      let positiveCount = 0;
      if (maxMagnitude > 0) {
        for (let i = 0; i < edgeMap.length; i++) {
          const value = edgeMap[i];
          if (value <= 0) continue;
          const bucket = Math.max(0, Math.min(histogram.length - 1, Math.floor((value / maxMagnitude) * (histogram.length - 1))));
          histogram[bucket] += 1;
          positiveCount += 1;
        }
      }

      const percentileFromHistogram = (percentile) => {
        if (positiveCount <= 0 || maxMagnitude <= 0) return 0;
        const thresholdCount = Math.max(1, Math.ceil(positiveCount * percentile));
        let cumulative = 0;
        for (let i = 0; i < histogram.length; i++) {
          cumulative += histogram[i];
          if (cumulative >= thresholdCount) {
            return (i / (histogram.length - 1)) * maxMagnitude;
          }
        }
        return maxMagnitude;
      };

      state.edgeMap = edgeMap;
      state.edgeGradX = gradXMap;
      state.edgeGradY = gradYMap;
      state.edgeColorData = new Uint8ClampedArray(srcData);
      state.edgeMapWidth = imageWidth;
      state.edgeMapHeight = imageHeight;
      state.edgeMapMean = mean;
      state.edgeMapStd = std;
      state.edgeMapMax = maxMagnitude;
      state.edgeMapP55 = percentileFromHistogram(0.55);
      state.edgeMapP70 = percentileFromHistogram(0.70);
      state.edgeMapP82 = percentileFromHistogram(0.82);
      state.edgeMapP92 = percentileFromHistogram(0.92);

      const normalizeByPercentile = (value, low, high) => {
        if (!Number.isFinite(value)) return 0;
        if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) {
          return value > 0 ? 1 : 0;
        }
        return Math.max(0, Math.min(1, (value - low) / (high - low)));
      };

      for (let i = 0; i < edgeMap.length; i++) {
        edgeMap[i] = normalizeByPercentile(edgeMap[i], state.edgeMapP55, state.edgeMapP92);
      }
    };

    const sampleMapBilinear = (map, width, height, x, y) => {
      if (!map || width < 1 || height < 1) return 0;
      const safeX = Math.max(0, Math.min(width - 1.0001, x));
      const safeY = Math.max(0, Math.min(height - 1.0001, y));

      const x0 = Math.floor(safeX);
      const y0 = Math.floor(safeY);
      const x1 = Math.min(width - 1, x0 + 1);
      const y1 = Math.min(height - 1, y0 + 1);

      const tx = safeX - x0;
      const ty = safeY - y0;

      const i00 = (y0 * width) + x0;
      const i10 = (y0 * width) + x1;
      const i01 = (y1 * width) + x0;
      const i11 = (y1 * width) + x1;

      const a = map[i00] * (1 - tx) + (map[i10] * tx);
      const b = map[i01] * (1 - tx) + (map[i11] * tx);
      return a * (1 - ty) + (b * ty);
    };

    const edgeStrengthAt = (x, y) => {
      if (!state.edgeMap) return 0;
      return sampleMapBilinear(state.edgeMap, state.edgeMapWidth, state.edgeMapHeight, x, y);
    };

    const edgeGradientAt = (x, y) => {
      if (!state.edgeGradX || !state.edgeGradY) return { gx: 0, gy: 0 };
      return {
        gx: sampleMapBilinear(state.edgeGradX, state.edgeMapWidth, state.edgeMapHeight, x, y),
        gy: sampleMapBilinear(state.edgeGradY, state.edgeMapWidth, state.edgeMapHeight, x, y)
      };
    };

    const sampleColorAt = (x, y) => {
      const data = state.edgeColorData;
      const width = state.edgeMapWidth;
      const height = state.edgeMapHeight;
      if (!data || width < 1 || height < 1) return { r: 0, g: 0, b: 0 };

      const cx = Math.max(0, Math.min(width - 1, Math.round(x)));
      const cy = Math.max(0, Math.min(height - 1, Math.round(y)));
      const idx = ((cy * width) + cx) * 4;
      return {
        r: data[idx],
        g: data[idx + 1],
        b: data[idx + 2]
      };
    };

    const colorContrastAcrossNormal = (x, y, normal, tangent) => {
      const probeDistance = 2.6;
      const tangentSpread = 1.25;
      let posR = 0;
      let posG = 0;
      let posB = 0;
      let negR = 0;
      let negG = 0;
      let negB = 0;
      let sampleCount = 0;

      for (let k = -1; k <= 1; k++) {
        const tx = tangent.x * k * tangentSpread;
        const ty = tangent.y * k * tangentSpread;
        const positive = sampleColorAt(x + tx + (normal.x * probeDistance), y + ty + (normal.y * probeDistance));
        const negative = sampleColorAt(x + tx - (normal.x * probeDistance), y + ty - (normal.y * probeDistance));

        posR += positive.r;
        posG += positive.g;
        posB += positive.b;
        negR += negative.r;
        negG += negative.g;
        negB += negative.b;
        sampleCount += 1;
      }

      if (sampleCount <= 0) return 0;
      const avgPosR = posR / sampleCount;
      const avgPosG = posG / sampleCount;
      const avgPosB = posB / sampleCount;
      const avgNegR = negR / sampleCount;
      const avgNegG = negG / sampleCount;
      const avgNegB = negB / sampleCount;
      const distance = Math.sqrt(
        ((avgPosR - avgNegR) ** 2)
        + ((avgPosG - avgNegG) ** 2)
        + ((avgPosB - avgNegB) ** 2)
      );
      return distance / 255;
    };

    const normalizeVector = (x, y, fallback = { x: 1, y: 0 }) => {
      const len = Math.sqrt((x * x) + (y * y));
      if (len < 0.0001) return { x: fallback.x, y: fallback.y };
      return { x: x / len, y: y / len };
    };

    const isStrokeClosed = (points) => {
      if (!Array.isArray(points) || points.length < 4) return false;
      const first = points[0];
      const last = points[points.length - 1];
      const distance = Math.sqrt(((last.x - first.x) ** 2) + ((last.y - first.y) ** 2));
      return distance <= 14;
    };

    const resampleStroke = (points, stepPx = 1.25, maxPoints = 2400) => {
      if (!Array.isArray(points) || points.length < 2) {
        return Array.isArray(points) ? points.map((point) => ({ x: point.x, y: point.y })) : [];
      }

      const output = [{ x: points[0].x, y: points[0].y }];
      for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        const dx = curr.x - prev.x;
        const dy = curr.y - prev.y;
        const segLen = Math.sqrt((dx * dx) + (dy * dy));
        if (segLen < 0.0001) continue;

        const ux = dx / segLen;
        const uy = dy / segLen;
        for (let d = stepPx; d < segLen; d += stepPx) {
          output.push({ x: prev.x + (ux * d), y: prev.y + (uy * d) });
        }
        output.push({ x: curr.x, y: curr.y });
      }

      if (output.length <= maxPoints) return output;

      const stride = Math.max(2, Math.ceil(output.length / maxPoints));
      const compact = [];
      for (let i = 0; i < output.length; i += stride) {
        compact.push(output[i]);
      }
      const last = output[output.length - 1];
      const lastCompact = compact[compact.length - 1];
      if (!lastCompact || lastCompact.x !== last.x || lastCompact.y !== last.y) {
        compact.push(last);
      }
      return compact;
    };

    const computeTangentsAndNormals = (points, { closed = false } = {}) => {
      const tangents = [];
      const normals = [];

      for (let i = 0; i < points.length; i++) {
        const prevIndex = closed ? ((i - 1 + points.length) % points.length) : Math.max(0, i - 1);
        const nextIndex = closed ? ((i + 1) % points.length) : Math.min(points.length - 1, i + 1);
        const prev = points[prevIndex];
        const next = points[nextIndex];
        const fallback = tangents[i - 1] ?? { x: 1, y: 0 };
        const tangent = normalizeVector(next.x - prev.x, next.y - prev.y, fallback);
        tangents.push(tangent);
        normals.push({ x: -tangent.y, y: tangent.x });
      }

      return { tangents, normals };
    };

    const buildEdgeSnapThresholds = () => {
      const tolerance = Math.max(0, Math.min(100, Number(state.edgeSnapTolerance ?? 50)));
      const t = tolerance / 100;
      const strictness = 1 - t;
      const edgeFloor = 0.72 - (t * 0.64);

      return {
        resampleStep: 1.15,
        radius: Math.round(12 + (t * 34)),
        tangentRadius: Math.round(2 + (t * 9)),
        candidateLimit: Math.round(11 + (t * 8)),
        edgeFloor: Math.max(0.04, Math.min(0.92, edgeFloor)),
        contrastFloor: 0.06 - (t * 0.025),
        edgeWeight: 116,
        contrastWeight: 86,
        alignmentWeight: 24,
        normalPenalty: 1.25 + (strictness * 1.35),
        tangentPenalty: 1.7 + (strictness * 1.6),
        anchorPenalty: 0.72 + (strictness * 0.52),
        transitionPenalty: 2.9 + (strictness * 2.1),
        orthogonalPenalty: 5.4 + (strictness * 3.6),
        longJumpPenalty: 7.0 + (strictness * 3.5),
        sideJumpPenalty: 7.8 + (strictness * 4.2),
        maxNormalOffset: 6.5 + (t * 13.5),
        boundaryPinBand: 0,
        boundaryPinScore: 0,
        maxOutsideAllowance: Number.POSITIVE_INFINITY,
        maxExpectedStepScale: 3.0 + (t * 2.7),
        smoothingPasses: 2 + Math.round(t * 2),
        minPointDistanceAfterRefine: 0.75
      };
    };

    const collectCandidatesForPoint = ({
      point,
      anchorPoint,
      tangent,
      normal,
      thresholds,
      localRadiusScale = 1,
      localTangentialScale = 1
    }) => {
      if (!point || !anchorPoint || !tangent || !normal) return [];

      const imageWidth = state.edgeMapWidth;
      const imageHeight = state.edgeMapHeight;
      const radius = Math.max(2, Math.round(thresholds.radius * localRadiusScale));
      const tangentRadius = Math.max(1, Math.round(thresholds.tangentRadius * localTangentialScale));

      const all = [];

      for (let dt = -tangentRadius; dt <= tangentRadius; dt++) {
        const tx = tangent.x * dt;
        const ty = tangent.y * dt;

        for (let dn = -radius; dn <= radius; dn++) {
          const px = point.x + tx + (normal.x * dn);
          const py = point.y + ty + (normal.y * dn);

          if (px <= 1 || py <= 1 || px >= (imageWidth - 2) || py >= (imageHeight - 2)) continue;

          const edgeStrength = edgeStrengthAt(px, py);
          const contrast = colorContrastAcrossNormal(px, py, normal, tangent);
          if (edgeStrength < thresholds.edgeFloor && contrast < thresholds.contrastFloor) continue;

          const gradient = edgeGradientAt(px, py);
          const gradientLen = Math.sqrt((gradient.gx * gradient.gx) + (gradient.gy * gradient.gy));
          const alignment = gradientLen > 0.0001
            ? Math.abs(((gradient.gx / gradientLen) * normal.x) + ((gradient.gy / gradientLen) * normal.y))
            : 0;

          const anchorDistance = Math.sqrt(((px - anchorPoint.x) ** 2) + ((py - anchorPoint.y) ** 2));

          all.push({
            x: px,
            y: py,
            edgeStrength,
            contrast,
            alignment,
            dnAbs: Math.abs(dn),
            dtAbs: Math.abs(dt),
            anchorDistance,
            isFallback: false
          });
        }
      }

      const fallbackEdge = edgeStrengthAt(anchorPoint.x, anchorPoint.y);
      const fallbackContrast = colorContrastAcrossNormal(anchorPoint.x, anchorPoint.y, normal, tangent);
      all.push({
        x: anchorPoint.x,
        y: anchorPoint.y,
        edgeStrength: fallbackEdge,
        contrast: fallbackContrast,
        alignment: 0,
        dnAbs: 0,
        dtAbs: 0,
        anchorDistance: 0,
        isFallback: true
      });

      let minEdge = Number.POSITIVE_INFINITY;
      let maxEdge = Number.NEGATIVE_INFINITY;
      let minContrast = Number.POSITIVE_INFINITY;
      let maxContrast = Number.NEGATIVE_INFINITY;

      for (const candidate of all) {
        if (candidate.edgeStrength < minEdge) minEdge = candidate.edgeStrength;
        if (candidate.edgeStrength > maxEdge) maxEdge = candidate.edgeStrength;
        if (candidate.contrast < minContrast) minContrast = candidate.contrast;
        if (candidate.contrast > maxContrast) maxContrast = candidate.contrast;
      }

      const normalizeRange = (value, minValue, maxValue) => {
        if (!Number.isFinite(value)) return 0;
        if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || maxValue <= minValue) {
          return value > 0 ? 1 : 0;
        }
        return Math.max(0, Math.min(1, (value - minValue) / (maxValue - minValue)));
      };

      for (const candidate of all) {
        const localEdge = normalizeRange(candidate.edgeStrength, minEdge, maxEdge);
        const localContrast = normalizeRange(candidate.contrast, minContrast, maxContrast);
        const score = (localEdge * thresholds.edgeWeight)
          + (localContrast * thresholds.contrastWeight)
          + (candidate.alignment * thresholds.alignmentWeight)
          - (candidate.dnAbs * thresholds.normalPenalty)
          - (candidate.dtAbs * thresholds.tangentPenalty)
          - (candidate.anchorDistance * thresholds.anchorPenalty);

        candidate.score = candidate.isFallback ? (score * 0.94) : score;
      }

      all.sort((a, b) => b.score - a.score);
      const selected = [];
      for (const candidate of all) {
        if (selected.length >= thresholds.candidateLimit) break;

        const duplicate = selected.some((existing) => {
          const dx = existing.x - candidate.x;
          const dy = existing.y - candidate.y;
          return ((dx * dx) + (dy * dy)) < 0.36;
        });

        if (!duplicate) {
          selected.push({
            x: candidate.x,
            y: candidate.y,
            score: candidate.score
          });
        }
      }

      return selected;
    };

    const optimizeCandidatePath = (candidateSets, anchors, tangents, normals, thresholds) => {
      if (!Array.isArray(candidateSets) || candidateSets.length === 0) return [];

      let prevScores = candidateSets[0].map((candidate) => candidate.score);
      const backRefs = Array.from({ length: candidateSets.length }, () => []);
      backRefs[0] = candidateSets[0].map(() => -1);

      for (let i = 1; i < candidateSets.length; i++) {
        const prevCandidates = candidateSets[i - 1];
        const currCandidates = candidateSets[i];
        const tangent = tangents[i] ?? { x: 1, y: 0 };
        const normal = normals[i] ?? { x: 0, y: 1 };
        const expectedStep = Math.max(0.5, Math.sqrt(
          ((anchors[i].x - anchors[i - 1].x) ** 2)
          + ((anchors[i].y - anchors[i - 1].y) ** 2)
        ));
        const maxStep = expectedStep * thresholds.maxExpectedStepScale;

        const currScores = new Array(currCandidates.length).fill(Number.NEGATIVE_INFINITY);
        const currBackRefs = new Array(currCandidates.length).fill(0);

        for (let j = 0; j < currCandidates.length; j++) {
          const candidate = currCandidates[j];
          let bestScore = Number.NEGATIVE_INFINITY;
          let bestPrevIndex = 0;

          for (let k = 0; k < prevCandidates.length; k++) {
            const prev = prevCandidates[k];
            const moveX = candidate.x - prev.x;
            const moveY = candidate.y - prev.y;
            const jumpDistance = Math.sqrt((moveX * moveX) + (moveY * moveY));
            const alongTangent = Math.abs((moveX * tangent.x) + (moveY * tangent.y));
            const acrossNormal = Math.abs((moveX * normal.x) + (moveY * normal.y));
            const prevOffsetN = ((prev.x - anchors[i - 1].x) * normal.x) + ((prev.y - anchors[i - 1].y) * normal.y);
            const currOffsetN = ((candidate.x - anchors[i].x) * normal.x) + ((candidate.y - anchors[i].y) * normal.y);
            const sideDelta = Math.abs(currOffsetN - prevOffsetN);

            const continuityPenalty = Math.abs(jumpDistance - expectedStep) * thresholds.transitionPenalty;
            const orthogonalPenalty = acrossNormal * thresholds.orthogonalPenalty;
            const longJumpPenalty = Math.max(0, jumpDistance - maxStep) * thresholds.longJumpPenalty;
            const shortStepPenalty = Math.max(0, (expectedStep * 0.24) - alongTangent) * thresholds.transitionPenalty;
            const sideJumpPenalty = sideDelta * thresholds.sideJumpPenalty;

            if (Math.abs(currOffsetN) > thresholds.maxNormalOffset) {
              continue;
            }

            const score = prevScores[k]
              + candidate.score
              - continuityPenalty
              - orthogonalPenalty
              - longJumpPenalty
              - shortStepPenalty
              - sideJumpPenalty;

            if (score > bestScore) {
              bestScore = score;
              bestPrevIndex = k;
            }
          }

          currScores[j] = bestScore;
          currBackRefs[j] = bestPrevIndex;
        }

        prevScores = currScores;
        backRefs[i] = currBackRefs;
      }

      let finalIndex = 0;
      let finalScore = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < prevScores.length; i++) {
        if (prevScores[i] > finalScore) {
          finalScore = prevScores[i];
          finalIndex = i;
        }
      }

      const refined = new Array(candidateSets.length);
      let cursor = finalIndex;

      for (let i = candidateSets.length - 1; i >= 0; i--) {
        const candidate = candidateSets[i][cursor] ?? candidateSets[i][0];
        refined[i] = { x: candidate.x, y: candidate.y };
        const prevCursor = backRefs[i]?.[cursor];
        cursor = Number.isInteger(prevCursor) && prevCursor >= 0 ? prevCursor : 0;
      }

      return refined;
    };

    const smoothPath = (points, passes = 2, { closed = false } = {}) => {
      if (!Array.isArray(points) || points.length < 3) {
        return Array.isArray(points) ? points.map((point) => ({ x: point.x, y: point.y })) : [];
      }

      let output = points.map((point) => ({ x: point.x, y: point.y }));
      for (let pass = 0; pass < passes; pass++) {
        const next = output.map((point, index) => {
          if (!closed && (index === 0 || index === output.length - 1)) {
            return { x: point.x, y: point.y };
          }

          const prev = output[(index - 1 + output.length) % output.length];
          const curr = output[index];
          const after = output[(index + 1) % output.length];
          return {
            x: (prev.x * 0.22) + (curr.x * 0.56) + (after.x * 0.22),
            y: (prev.y * 0.22) + (curr.y * 0.56) + (after.y * 0.22)
          };
        });
        output = next;
      }

      return output;
    };

    const polishPathToEdges = (points, thresholds, { closed = false } = {}) => {
      if (!Array.isArray(points) || points.length < 3) {
        return Array.isArray(points) ? points.map((point) => ({ x: point.x, y: point.y })) : [];
      }

      const { tangents, normals } = computeTangentsAndNormals(points, { closed });
      const polished = [];

      for (let i = 0; i < points.length; i++) {
        const anchor = points[i];
        const candidates = collectCandidatesForPoint({
          point: anchor,
          anchorPoint: anchor,
          tangent: tangents[i],
          normal: normals[i],
          thresholds,
          localRadiusScale: 0.35,
          localTangentialScale: 0.45
        });

        if (candidates.length === 0) {
          polished.push({ x: anchor.x, y: anchor.y });
          continue;
        }

        let best = candidates[0];
        let bestScore = Number.NEGATIVE_INFINITY;
        for (const candidate of candidates) {
          const distance = Math.sqrt(((candidate.x - anchor.x) ** 2) + ((candidate.y - anchor.y) ** 2));
          const score = candidate.score - (distance * (thresholds.anchorPenalty + 1.8));
          if (score > bestScore) {
            bestScore = score;
            best = candidate;
          }
        }

        polished.push({ x: best.x, y: best.y });
      }

      return polished;
    };

    const simplifyPath = (points, minDistance = 0.8) => {
      if (!Array.isArray(points) || points.length < 3) return points ?? [];
      const minDistanceSq = minDistance * minDistance;

      const simplified = [{ x: points[0].x, y: points[0].y }];
      for (let i = 1; i < points.length - 1; i++) {
        const prev = simplified[simplified.length - 1];
        const curr = points[i];
        const dx = curr.x - prev.x;
        const dy = curr.y - prev.y;
        if ((dx * dx) + (dy * dy) >= minDistanceSq) {
          simplified.push({ x: curr.x, y: curr.y });
        }
      }
      const last = points[points.length - 1];
      simplified.push({ x: last.x, y: last.y });
      return simplified;
    };

    const averageEdgeStrength = (points) => {
      if (!Array.isArray(points) || points.length === 0) return 0;
      let sum = 0;
      for (const point of points) {
        sum += edgeStrengthAt(point.x, point.y);
      }
      return sum / points.length;
    };

    const refineStrokeToEdges = (rawStroke) => {
      if (!Array.isArray(rawStroke) || rawStroke.length < 3) {
        return rawStroke;
      }

      ensureEdgeMap();
      if (!state.edgeMap || !state.edgeColorData) {
        return rawStroke;
      }

      const sourceStroke = rawStroke.map((point) => ({ x: point.x, y: point.y }));
      const closed = isStrokeClosed(sourceStroke);
      const thresholds = buildEdgeSnapThresholds();

      const resampled = resampleStroke(sourceStroke, thresholds.resampleStep);
      if (resampled.length < 3) {
        return sourceStroke;
      }

      const { tangents, normals } = computeTangentsAndNormals(resampled, { closed });
      const candidateSets = [];
      for (let i = 0; i < resampled.length; i++) {
        candidateSets.push(collectCandidatesForPoint({
          point: resampled[i],
          anchorPoint: resampled[i],
          tangent: tangents[i],
          normal: normals[i],
          thresholds
        }));
      }

      let refined = optimizeCandidatePath(candidateSets, resampled, tangents, normals, thresholds);
      if (!Array.isArray(refined) || refined.length < 3) {
        return sourceStroke;
      }

      refined = smoothPath(refined, thresholds.smoothingPasses, { closed });
      refined = polishPathToEdges(refined, thresholds, { closed });
      refined = smoothPath(refined, 1, { closed });
      refined = simplifyPath(refined, thresholds.minPointDistanceAfterRefine);

      const imageWidth = state.edgeMapWidth;
      const imageHeight = state.edgeMapHeight;
      refined = refined
        .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
        .map((point) => ({
          x: Math.max(0, Math.min(imageWidth - 1, point.x)),
          y: Math.max(0, Math.min(imageHeight - 1, point.y))
        }));

      if (refined.length < 3) {
        return sourceStroke;
      }

      let movedPoints = 0;
      let totalDisplacement = 0;
      for (let i = 0; i < refined.length; i++) {
        const sourceIndex = refined.length > 1
          ? Math.round((i / (refined.length - 1)) * (resampled.length - 1))
          : 0;
        const sourcePoint = resampled[sourceIndex] ?? resampled[0];
        const dx = refined[i].x - sourcePoint.x;
        const dy = refined[i].y - sourcePoint.y;
        const displacementSq = (dx * dx) + (dy * dy);
        if (displacementSq > 0.64) movedPoints += 1;
        totalDisplacement += Math.sqrt(displacementSq);
      }

      const movedRatio = movedPoints / Math.max(1, refined.length);
      const meanDisplacement = totalDisplacement / Math.max(1, refined.length);
      const rawEdge = averageEdgeStrength(resampled);
      const refinedEdge = averageEdgeStrength(refined);
      const edgeGain = rawEdge > 0 ? (refinedEdge / rawEdge) : (refinedEdge > 0 ? 2 : 1);

      if (!Number.isFinite(edgeGain) || (edgeGain < 1.003 && movedRatio < 0.02 && meanDisplacement < 0.35)) {
        return sourceStroke;
      }

      return refined;
    };

    updateSnapUi();

    const refreshAlphaControls = () => {
      const hasFixedSelection = !!state.isFixed;
      const hasPending = state.alphaPendingPolygons.length > 0;
      const hasApplied = state.alphaAppliedPolygons.length > 0;
      const hasCurrentStroke = !!(state.alphaCurrentStroke?.length);

      alphaToggleBtn.disabled = !hasFixedSelection;
      alphaApplyBtn.disabled = !state.alphaDrawEnabled || !hasPending;
      alphaUndoBtn.disabled = !(hasPending || hasCurrentStroke || hasApplied);
      alphaClearBtn.disabled = !(hasPending || hasCurrentStroke || hasApplied);

      alphaToggleBtn.classList.toggle("is-active", state.alphaDrawEnabled);
      stageCanvas.classList.toggle("is-alpha-draw", state.alphaDrawEnabled);

      if (!hasFixedSelection) {
        alphaStatusEl.textContent = game.i18n.localize("MTA.ManualAlphaStatusNeedLock");
      } else if (state.alphaDrawEnabled) {
        const count = state.alphaPendingPolygons.length;
        alphaStatusEl.textContent = game.i18n.format("MTA.ManualAlphaStatusDrawing", { count });
      } else if (state.alphaAppliedPolygons.length > 0) {
        const count = state.alphaAppliedPolygons.length;
        alphaStatusEl.textContent = game.i18n.format("MTA.ManualAlphaStatusApplied", { count });
      } else {
        alphaStatusEl.textContent = game.i18n.localize("MTA.ManualAlphaStatusIdle");
      }
    };

    state.alphaRefreshControls = refreshAlphaControls;

    const scheduleStageRender = () => {
      if (state.renderRafId) {
        cancelAnimationFrame(state.renderRafId);
      }

      state.renderRafId = requestAnimationFrame(() => {
        state.renderRafId = null;
        this.#renderManualTokenStage(state);
      });
    };

    const MIN_STROKE_POINT_DISTANCE_PX = 1.25;
    const MIN_POLYGON_AREA_PX = 5;

    const toSourcePointFromEvent = (event) => {
      if (!state.metrics) return null;
      const rect = stageCanvas.getBoundingClientRect();
      return this.#manualCanvasToSourcePoint(state, event.clientX - rect.left, event.clientY - rect.top);
    };

    const computePolygonArea = (points) => {
      if (!Array.isArray(points) || points.length < 3) return 0;
      let area = 0;
      for (let i = 0; i < points.length; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];
        area += (p1.x * p2.y) - (p2.x * p1.y);
      }
      return Math.abs(area) * 0.5;
    };

    const appendStrokePoint = (point) => {
      if (!point || !state.alphaCurrentStroke) return false;
      const stroke = state.alphaCurrentStroke;
      const lastPoint = stroke[stroke.length - 1];
      if (!lastPoint) {
        stroke.push({ x: point.x, y: point.y });
        return true;
      }

      const dx = point.x - lastPoint.x;
      const dy = point.y - lastPoint.y;
      if ((dx * dx + dy * dy) < (MIN_STROKE_POINT_DISTANCE_PX * MIN_STROKE_POINT_DISTANCE_PX)) {
        return false;
      }

      stroke.push({ x: point.x, y: point.y });
      return true;
    };

    const finalizeAlphaStroke = () => {
      if (!state.alphaCurrentStroke) return false;

      const strokeMode = state.alphaCurrentStrokeMode === "subtract" ? "subtract" : "add";
      const polygon = state.alphaCurrentStroke.map((point) => ({ x: point.x, y: point.y }));
      state.alphaCurrentStroke = null;
      state.alphaCurrentStrokeMode = "add";

      if (polygon.length < 3) return false;
      const area = computePolygonArea(polygon);
      if (!Number.isFinite(area) || area < MIN_POLYGON_AREA_PX) return false;

      state.alphaPendingPolygons.push({
        operation: strokeMode,
        points: polygon
      });
      state.alphaMaskVersion += 1;
      return true;
    };

    const clearAlphaState = () => {
      state.alphaDrawEnabled = false;
      state.alphaCurrentStroke = null;
      state.alphaCurrentStrokeMode = "add";
      state.alphaPendingPolygons = [];
      state.alphaAppliedPolygons = [];
      state.alphaMaskVersion = 0;
      state.alphaMaskAppliedVersion = -1;
      state.edgeSnapEnabled = false;
      state.edgeSnapLastPoint = null;
      state.edgeSnapLatched = false;
      state.edgeMap = null;
      state.edgeGradX = null;
      state.edgeGradY = null;
      state.edgeColorData = null;
      state.edgeMapWidth = 0;
      state.edgeMapHeight = 0;
      state.edgeMapMean = 0;
      state.edgeMapStd = 0;
      state.edgeMapMax = 0;
      state.edgeMapP55 = 0;
      state.edgeMapP70 = 0;
      state.edgeMapP82 = 0;
      state.edgeMapP92 = 0;
    };

    const onMouseMove = (event) => {
      if (!state.metrics) return;
      const rect = stageCanvas.getBoundingClientRect();
      const canvasX = event.clientX - rect.left;
      const canvasY = event.clientY - rect.top;

      if (state.isPanning && state.panStart) {
        const deltaX = event.clientX - state.panStart.clientX;
        const deltaY = event.clientY - state.panStart.clientY;
        state.panX = state.panStart.panX + deltaX;
        state.panY = state.panStart.panY + deltaY;
        this.#renderManualTokenStage(state);
        return;
      }

      if (state.alphaDrawEnabled && state.alphaCurrentStroke) {
        let point = this.#manualCanvasToSourcePoint(state, canvasX, canvasY);
        if (point) appendStrokePoint(point);
        this.#renderManualTokenStage(state);
        return;
      }

      if (state.alphaDrawEnabled) {
        return;
      }

      const point = this.#manualCanvasToSourcePoint(state, canvasX, canvasY);
      if (!point) {
        if (!state.isFixed) state.hoverSource = null;
        this.#renderManualTokenStage(state);
        return;
      }

      if (!state.isFixed) {
        state.hoverSource = point;
      }

      this.#renderManualTokenStage(state);
    };

    const onMouseLeave = () => {
      if (state.alphaDrawEnabled) return;
      if (!state.isFixed && !state.isPanning) {
        state.hoverSource = null;
        this.#renderManualTokenStage(state);
      }
    };

    const onContextMenu = (event) => {
      event.preventDefault();
    };

    const onMouseDown = (event) => {
      if (event.button === 0 && state.alphaDrawEnabled) {
        event.preventDefault();
        if (!state.isFixed) {
          refreshAlphaControls();
          return;
        }

        const point = toSourcePointFromEvent(event);
        if (!point) return;

        state.edgeSnapEnabled = !!event.ctrlKey;
        state.edgeSnapLastPoint = null;
        state.edgeSnapLatched = false;
        state.alphaCurrentStrokeMode = event.altKey ? "subtract" : "add";
        state.alphaCurrentStroke = [{ x: point.x, y: point.y }];
        refreshAlphaControls();
        this.#renderManualTokenStage(state);
        return;
      }

      if (event.button !== 2) return;
      event.preventDefault();

      state.isPanning = true;
      state.panStart = {
        clientX: event.clientX,
        clientY: event.clientY,
        panX: state.panX,
        panY: state.panY
      };
      stageCanvas.classList.add("is-panning");
    };

    const onMouseUp = (event) => {
      if (event.button === 0 && state.alphaCurrentStroke) {
        if (state.edgeSnapEnabled) {
          const refined = refineStrokeToEdges(state.alphaCurrentStroke);
          state.alphaCurrentStroke = Array.isArray(refined) ? refined : state.alphaCurrentStroke;
        }

        finalizeAlphaStroke();
        state.edgeSnapEnabled = false;
        state.edgeSnapLastPoint = null;
        state.edgeSnapLatched = false;
        refreshAlphaControls();
        this.#renderManualTokenStage(state);
        return;
      }

      if (!state.isPanning) return;
      if (event.button !== 2 && (event.buttons & 2) === 2) return;

      state.isPanning = false;
      state.panStart = null;
      stageCanvas.classList.remove("is-panning");
      this.#renderManualTokenStage(state);
    };

    const onClick = (event) => {
      if (event.button !== 0) return;
      if (state.isPanning) return;
      if (state.alphaDrawEnabled) return;

      if (state.isFixed) {
        state.isFixed = false;
        state.fixedSource = null;
        state.fixedCircleRadiusPx = null;
        state.fixedSelection = null;
        clearAlphaState();
        refreshAlphaControls();
        this.#renderManualTokenStage(state);
        return;
      }

      const rect = stageCanvas.getBoundingClientRect();
      const point = this.#manualCanvasToSourcePoint(state, event.clientX - rect.left, event.clientY - rect.top);
      if (!point) return;

      state.isFixed = true;
      state.fixedSource = point;
      state.hoverSource = point;
      state.fixedCircleRadiusPx = state.circleRadiusPx;
      const lockDrawScale = Math.max(0.0001, state.metrics?.drawScale ?? 1);
      const lockCropSize = (state.circleRadiusPx * 2) / lockDrawScale;
      state.fixedSelection = {
        centerX: point.x,
        centerY: point.y,
        cropSize: lockCropSize
      };
      clearAlphaState();
      refreshAlphaControls();
      this.#renderManualTokenStage(state);
    };

    const onWheel = (event) => {
      event.preventDefault();
      if (state.alphaCurrentStroke) return;

      if (!state.metrics) return;
      const rect = stageCanvas.getBoundingClientRect();
      let anchorCanvasX = event.clientX - rect.left;
      let anchorCanvasY = event.clientY - rect.top;
      const previousMetrics = state.metrics;

      const previousDrawScale = previousMetrics.drawScale;
      if (!Number.isFinite(previousDrawScale) || previousDrawScale <= 0) return;

      let sourceXBeforeZoom = (anchorCanvasX - previousMetrics.offsetX) / previousDrawScale;
      let sourceYBeforeZoom = (anchorCanvasY - previousMetrics.offsetY) / previousDrawScale;

      // В режиме фиксации зум якорится в фиксированной точке круга, чтобы выборка не "уплывала".
      if (state.isFixed && state.fixedSource) {
        sourceXBeforeZoom = state.fixedSource.x;
        sourceYBeforeZoom = state.fixedSource.y;
        anchorCanvasX = previousMetrics.offsetX + (sourceXBeforeZoom * previousDrawScale);
        anchorCanvasY = previousMetrics.offsetY + (sourceYBeforeZoom * previousDrawScale);
      }

      const zoomStep = event.deltaY < 0 ? 1.1 : (1 / 1.1);
      const nextZoom = Math.min(state.zoomMax, Math.max(state.zoomMin, state.zoom * zoomStep));
      if (Math.abs(nextZoom - state.zoom) < 0.0001) return;

      state.zoom = nextZoom;

      const imageWidth = state.image.naturalWidth || state.image.width;
      const imageHeight = state.image.naturalHeight || state.image.height;
      const fitScale = Math.min(previousMetrics.width / imageWidth, previousMetrics.height / imageHeight);
      const nextDrawScale = Math.max(0.0001, fitScale * state.zoom);
      const nextDrawWidth = imageWidth * nextDrawScale;
      const nextDrawHeight = imageHeight * nextDrawScale;

      const baseOffsetX = (previousMetrics.width - nextDrawWidth) / 2;
      const baseOffsetY = (previousMetrics.height - nextDrawHeight) / 2;

      const safeSourceX = Number.isFinite(sourceXBeforeZoom) ? sourceXBeforeZoom : (imageWidth / 2);
      const safeSourceY = Number.isFinite(sourceYBeforeZoom) ? sourceYBeforeZoom : (imageHeight / 2);

      const targetOffsetX = anchorCanvasX - (safeSourceX * nextDrawScale);
      const targetOffsetY = anchorCanvasY - (safeSourceY * nextDrawScale);

      state.panX = targetOffsetX - baseOffsetX;
      state.panY = targetOffsetY - baseOffsetY;
      this.#renderManualTokenStage(state);
    };

    const onAlphaToggle = () => {
      if (!state.isFixed) {
        ui.notifications.warn(game.i18n.localize("MTA.ManualAlphaNeedLock"));
        refreshAlphaControls();
        return;
      }

      state.alphaDrawEnabled = !state.alphaDrawEnabled;
      if (!state.alphaDrawEnabled) {
        state.alphaCurrentStroke = null;
        state.alphaCurrentStrokeMode = "add";
      }

      refreshAlphaControls();
      this.#renderManualTokenStage(state);
    };

    const onAlphaApply = () => {
      if (!state.isFixed) {
        ui.notifications.warn(game.i18n.localize("MTA.ManualAlphaNeedLock"));
        refreshAlphaControls();
        return;
      }

      if (state.alphaCurrentStroke) {
        finalizeAlphaStroke();
      }

      if (state.alphaPendingPolygons.length === 0) {
        refreshAlphaControls();
        return;
      }

      const operationsToApply = state.alphaPendingPolygons
        .map((entry) => {
          const points = Array.isArray(entry) ? entry : entry?.points;
          if (!Array.isArray(points) || points.length < 3) return null;
          return {
            operation: entry?.operation === "subtract" ? "subtract" : "add",
            points: points.map((p) => ({ x: p.x, y: p.y }))
          };
        })
        .filter(Boolean);

      state.alphaAppliedPolygons.push(...operationsToApply);
      state.alphaPendingPolygons = [];
      state.alphaMaskVersion += 1;
      state.alphaMaskAppliedVersion = state.alphaMaskVersion;

      refreshAlphaControls();
      this.#renderManualTokenStage(state);
    };

    const onAlphaUndo = () => {
      let changed = false;

      if (state.alphaCurrentStroke) {
        state.alphaCurrentStroke = null;
        changed = true;
      } else if (state.alphaPendingPolygons.length > 0) {
        state.alphaPendingPolygons.pop();
        changed = true;
      } else if (state.alphaAppliedPolygons.length > 0) {
        state.alphaAppliedPolygons.pop();
        changed = true;
      }

      if (!changed) {
        refreshAlphaControls();
        return;
      }

      state.alphaMaskVersion += 1;
      refreshAlphaControls();
      this.#renderManualTokenStage(state);
    };

    const onAlphaClear = () => {
      if (!state.alphaCurrentStroke && state.alphaPendingPolygons.length === 0 && state.alphaAppliedPolygons.length === 0) {
        refreshAlphaControls();
        return;
      }

      state.alphaCurrentStroke = null;
      state.alphaCurrentStrokeMode = "add";
      state.alphaPendingPolygons = [];
      state.alphaAppliedPolygons = [];
      state.alphaMaskVersion += 1;
      state.alphaMaskAppliedVersion = -1;

      refreshAlphaControls();
      this.#renderManualTokenStage(state);
    };

    const onSnapRangeInput = (event) => {
      const raw = Number(event.currentTarget?.value ?? state.edgeSnapTolerance);
      const nextValue = Math.max(0, Math.min(100, Number.isFinite(raw) ? raw : 50));
      state.edgeSnapTolerance = nextValue;
      updateSnapUi();
    };

    const onCreate = async () => {
      if (!state.selection) {
        ui.notifications.warn(game.i18n.localize("MTA.ManualTokenSelectArea"));
        return;
      }

      if (state.alphaCurrentStroke || state.alphaPendingPolygons.length > 0) {
        ui.notifications.warn(game.i18n.localize("MTA.ManualAlphaPendingNotApplied"));
        return;
      }

      createBtn.disabled = true;
      cancelBtn.disabled = true;
      try {
        const service = AutoTokenService.instance();
        const { blob } = await service.createTokenBlobFromSelection({
          imageSource: state.image,
          centerX: state.selection.centerX,
          centerY: state.selection.centerY,
          cropSize: state.selection.cropSize,
          alphaPolygons: state.alphaAppliedPolygons
        });

        const saved = await this.#persistGeneratedTokenBlob({
          blob,
          src: state.src,
          imageType: state.imageType,
          index: state.index,
          generationMode: "manual"
        });

        if (!saved) return;
        ui.notifications.info(game.i18n.localize("MTA.ManualTokenCreated"));
        dialog.close();
        this.render();
      } catch (err) {
        console.error("[MTA ManualToken] Ошибка создания:", err);
        ui.notifications.error(`${game.i18n.localize("MTA.TokenCreateErrorPrefix")}: ${err.message}`);
      } finally {
        if (this._manualTokenDialog === dialog) {
          createBtn.disabled = false;
          cancelBtn.disabled = false;
        }
      }
    };

    const onCancel = () => dialog.close();
    const onWindowResize = () => this.#renderManualTokenStage(state);

    stageCanvas.addEventListener("mousemove", onMouseMove);
    stageCanvas.addEventListener("mouseleave", onMouseLeave);
    stageCanvas.addEventListener("contextmenu", onContextMenu);
    stageCanvas.addEventListener("mousedown", onMouseDown);
    stageCanvas.addEventListener("click", onClick);
    stageCanvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("mouseup", onMouseUp);
    alphaToggleBtn.addEventListener("click", onAlphaToggle);
    alphaApplyBtn.addEventListener("click", onAlphaApply);
    alphaUndoBtn.addEventListener("click", onAlphaUndo);
    alphaClearBtn.addEventListener("click", onAlphaClear);
    alphaSnapRangeEl.addEventListener("input", onSnapRangeInput);
    createBtn.addEventListener("click", onCreate);
    cancelBtn.addEventListener("click", onCancel);
    window.addEventListener("resize", onWindowResize);

    if (typeof ResizeObserver !== "undefined" && stageShell) {
      const observer = new ResizeObserver(() => {
        scheduleStageRender();
      });
      observer.observe(stageShell);
      state.resizeObserver = observer;
    }

    state.cleanup = () => {
      stageCanvas.removeEventListener("mousemove", onMouseMove);
      stageCanvas.removeEventListener("mouseleave", onMouseLeave);
      stageCanvas.removeEventListener("contextmenu", onContextMenu);
      stageCanvas.removeEventListener("mousedown", onMouseDown);
      stageCanvas.removeEventListener("click", onClick);
      stageCanvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("mouseup", onMouseUp);
      stageCanvas.classList.remove("is-panning");
      stageCanvas.classList.remove("is-alpha-draw");
      if (state.resizeObserver) {
        state.resizeObserver.disconnect();
        state.resizeObserver = null;
      }
      if (state.renderRafId) {
        cancelAnimationFrame(state.renderRafId);
        state.renderRafId = null;
      }
      if (state.initialRenderTimeout) {
        clearTimeout(state.initialRenderTimeout);
        state.initialRenderTimeout = null;
      }
      alphaToggleBtn.removeEventListener("click", onAlphaToggle);
      alphaApplyBtn.removeEventListener("click", onAlphaApply);
      alphaUndoBtn.removeEventListener("click", onAlphaUndo);
      alphaClearBtn.removeEventListener("click", onAlphaClear);
      alphaSnapRangeEl.removeEventListener("input", onSnapRangeInput);
      createBtn.removeEventListener("click", onCreate);
      cancelBtn.removeEventListener("click", onCancel);
      window.removeEventListener("resize", onWindowResize);
      state.alphaRefreshControls = null;
    };

    refreshAlphaControls();

    // Двойной стартовый рендер нужен, чтобы избежать визуального сжатия до
    // окончательной раскладки окна (наблюдалось до первого движения мыши).
    scheduleStageRender();
    state.initialRenderTimeout = setTimeout(() => {
      state.initialRenderTimeout = null;
      scheduleStageRender();
    }, 40);
  }

  #syncCanvasResolution(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(canvas.clientWidth || 1));
    const height = Math.max(1, Math.floor(canvas.clientHeight || 1));
    const pixelWidth = Math.max(1, Math.floor(width * dpr));
    const pixelHeight = Math.max(1, Math.floor(height * dpr));

    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

    return { width, height, dpr };
  }

  #clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  #clampManualOffsets({ width, height, drawWidth, drawHeight, offsetX, offsetY }) {
    const xRange = drawWidth >= width
      ? { min: width - drawWidth, max: 0 }
      : { min: 0, max: width - drawWidth };

    const yRange = drawHeight >= height
      ? { min: height - drawHeight, max: 0 }
      : { min: 0, max: height - drawHeight };

    return {
      offsetX: this.#clampNumber(offsetX, xRange.min, xRange.max),
      offsetY: this.#clampNumber(offsetY, yRange.min, yRange.max)
    };
  }

  #manualCanvasToSourcePoint(state, canvasX, canvasY) {
    const metrics = state.metrics;
    if (!metrics) return null;

    const imageWidth = state.image.naturalWidth || state.image.width;
    const imageHeight = state.image.naturalHeight || state.image.height;

    const inX = canvasX >= metrics.offsetX && canvasX <= (metrics.offsetX + metrics.drawWidth);
    const inY = canvasY >= metrics.offsetY && canvasY <= (metrics.offsetY + metrics.drawHeight);
    if (!inX || !inY) return null;

    const sourceX = (canvasX - metrics.offsetX) / metrics.drawScale;
    const sourceY = (canvasY - metrics.offsetY) / metrics.drawScale;
    if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY)) return null;

    return {
      x: Math.max(0, Math.min(imageWidth, sourceX)),
      y: Math.max(0, Math.min(imageHeight, sourceY))
    };
  }

  #renderManualTokenStage(state) {
    const stageCanvas = state.stageCanvas;
    const previewCanvas = state.previewCanvas;
    if (!stageCanvas || !previewCanvas) return;

    const { width, height, dpr } = this.#syncCanvasResolution(stageCanvas);
    const ctx = stageCanvas.getContext("2d");
    if (!ctx) return;

    const imageWidth = state.image.naturalWidth || state.image.width;
    const imageHeight = state.image.naturalHeight || state.image.height;
    const fitScale = Math.min(width / imageWidth, height / imageHeight);
    const drawScale = Math.max(0.0001, fitScale * state.zoom);
    const drawWidth = imageWidth * drawScale;
    const drawHeight = imageHeight * drawScale;
    const baseOffsetX = (width - drawWidth) / 2;
    const baseOffsetY = (height - drawHeight) / 2;

    const unclampedOffsetX = baseOffsetX + (state.panX ?? 0);
    const unclampedOffsetY = baseOffsetY + (state.panY ?? 0);
    const clampedOffsets = this.#clampManualOffsets({
      width,
      height,
      drawWidth,
      drawHeight,
      offsetX: unclampedOffsetX,
      offsetY: unclampedOffsetY
    });

    const offsetX = clampedOffsets.offsetX;
    const offsetY = clampedOffsets.offsetY;
    state.panX = offsetX - baseOffsetX;
    state.panY = offsetY - baseOffsetY;

    state.metrics = {
      width,
      height,
      drawScale,
      drawWidth,
      drawHeight,
      baseOffsetX,
      baseOffsetY,
      offsetX,
      offsetY
    };

    const drawSourceStrokePath = (ctx2d, points, drawScaleLocal, offsetXLocal, offsetYLocal) => {
      if (!Array.isArray(points) || points.length === 0) return;
      const first = points[0];
      ctx2d.moveTo(offsetXLocal + (first.x * drawScaleLocal), offsetYLocal + (first.y * drawScaleLocal));
      for (let i = 1; i < points.length; i++) {
        const p = points[i];
        ctx2d.lineTo(offsetXLocal + (p.x * drawScaleLocal), offsetYLocal + (p.y * drawScaleLocal));
      }
    };

    const drawSourcePolygonFill = (ctx2d, polygon, drawScaleLocal, offsetXLocal, offsetYLocal) => {
      if (!Array.isArray(polygon) || polygon.length < 3) return;
      ctx2d.beginPath();
      drawSourceStrokePath(ctx2d, polygon, drawScaleLocal, offsetXLocal, offsetYLocal);
      ctx2d.closePath();
      ctx2d.fill();
    };

    const drawSourcePathStroke = (ctx2d, points, drawScaleLocal, offsetXLocal, offsetYLocal) => {
      if (!Array.isArray(points) || points.length < 2) return;
      ctx2d.beginPath();
      drawSourceStrokePath(ctx2d, points, drawScaleLocal, offsetXLocal, offsetYLocal);
      ctx2d.stroke();
    };

    const stageSizeKey = `${width}x${height}`;
    if (state._stageSizeKey !== stageSizeKey || state.circleRadiusPx <= 0) {
      state.circleRadiusPx = Math.max(42, Math.min(width, height) * 0.22);
      state._stageSizeKey = stageSizeKey;
    }

    const computedCropSize = (state.circleRadiusPx * 2) / drawScale;
    const lockedCropSize = Number.isFinite(state.fixedSelection?.cropSize)
      ? state.fixedSelection.cropSize
      : computedCropSize;

    // В lock-режиме фиксируем область в координатах исходника (cropSize),
    // а радиус круга на экране пересчитываем через текущий drawScale,
    // чтобы круг "жил" вместе с изображением в левом окне.
    const effectiveCropSize = state.isFixed ? lockedCropSize : computedCropSize;
    const effectiveCircleRadiusPx = (effectiveCropSize * drawScale) / 2;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(state.image, offsetX, offsetY, drawWidth, drawHeight);

    const drawOperationOverlay = (entry, { isPending = false } = {}) => {
      const operation = entry?.operation === "subtract" ? "subtract" : "add";
      const points = Array.isArray(entry?.points)
        ? entry.points
        : (Array.isArray(entry) ? entry : null);
      if (!points || points.length < 3) return;

      ctx.save();
      if (operation === "subtract") {
        ctx.fillStyle = isPending ? "rgba(255, 72, 72, 0.48)" : "rgba(255, 72, 72, 0.58)";
      } else {
        ctx.fillStyle = isPending ? "rgba(255, 166, 87, 0.42)" : "rgba(34, 211, 238, 0.45)";
      }
      drawSourcePolygonFill(ctx, points, drawScale, offsetX, offsetY);
      ctx.restore();
    };

    const normalizeAlphaEntry = (entry, fallbackOperation = "add") => {
      if (Array.isArray(entry)) {
        return {
          operation: fallbackOperation,
          points: entry
        };
      }

      const points = entry?.points;
      if (!Array.isArray(points)) return null;
      return {
        operation: entry?.operation === "subtract" ? "subtract" : fallbackOperation,
        points
      };
    };

    const renderCompositedAlphaOverlay = (entries) => {
      if (!Array.isArray(entries) || entries.length === 0) return;

      const overlayCanvas = document.createElement("canvas");
      overlayCanvas.width = stageCanvas.width;
      overlayCanvas.height = stageCanvas.height;
      const overlayCtx = overlayCanvas.getContext("2d");
      if (!overlayCtx) return;

      overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      overlayCtx.clearRect(0, 0, width, height);
      overlayCtx.fillStyle = "#ffffff";

      for (const rawEntry of entries) {
        const entry = normalizeAlphaEntry(rawEntry);
        if (!entry || !Array.isArray(entry.points) || entry.points.length < 3) continue;

        overlayCtx.save();
        overlayCtx.globalCompositeOperation = entry.operation === "subtract" ? "destination-out" : "source-over";
        drawSourcePolygonFill(overlayCtx, entry.points, drawScale, offsetX, offsetY);
        overlayCtx.restore();
      }

      overlayCtx.save();
      overlayCtx.globalCompositeOperation = "source-in";
      overlayCtx.fillStyle = "#22d3ee";
      overlayCtx.fillRect(0, 0, width, height);
      overlayCtx.restore();

      ctx.save();
      ctx.globalAlpha = 0.52;
      ctx.drawImage(overlayCanvas, 0, 0, width, height);
      ctx.restore();
    };

    const overlayEntries = [
      ...state.alphaAppliedPolygons,
      ...state.alphaPendingPolygons
    ];

    if (Array.isArray(state.alphaCurrentStroke) && state.alphaCurrentStroke.length >= 3) {
      overlayEntries.push({
        operation: state.alphaCurrentStrokeMode === "subtract" ? "subtract" : "add",
        points: state.alphaCurrentStroke
      });
    }

    renderCompositedAlphaOverlay(overlayEntries);

    if (state.alphaCurrentStroke?.length > 1) {
      const isSubtractStroke = state.alphaCurrentStrokeMode === "subtract";
      ctx.save();
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = isSubtractStroke ? "#ff6b6b" : "#ffd08a";
      ctx.shadowColor = isSubtractStroke ? "rgba(255, 72, 72, 0.62)" : "rgba(255, 190, 100, 0.55)";
      ctx.shadowBlur = 4;
      ctx.setLineDash([8, 6]);
      drawSourcePathStroke(ctx, state.alphaCurrentStroke, drawScale, offsetX, offsetY);
      ctx.restore();
    }

    const activeSource = state.isFixed ? state.fixedSource : state.hoverSource;
    if (!activeSource) {
      this.#clearManualTokenPreview(state);
      state.selection = null;
      if (state.zoomValueEl) state.zoomValueEl.textContent = `${state.zoom.toFixed(2)}x`;
      return;
    }

    const circleX = offsetX + (activeSource.x * drawScale);
    const circleY = offsetY + (activeSource.y * drawScale);

    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.moveTo(circleX + effectiveCircleRadiusPx, circleY);
    ctx.arc(circleX, circleY, effectiveCircleRadiusPx, 0, Math.PI * 2, true);
    ctx.fill("evenodd");
    ctx.restore();

    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = state.isFixed ? "#22d3ee" : "#ff6400";
    ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(circleX, circleY, effectiveCircleRadiusPx, 0, Math.PI * 2);
    ctx.stroke();
    if (state.isFixed) {
      ctx.fillStyle = "#22d3ee";
      ctx.beginPath();
      ctx.arc(circleX, circleY, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    const cropSize = effectiveCropSize;

    const selectionCenterX = state.isFixed && Number.isFinite(state.fixedSelection?.centerX)
      ? state.fixedSelection.centerX
      : activeSource.x;
    const selectionCenterY = state.isFixed && Number.isFinite(state.fixedSelection?.centerY)
      ? state.fixedSelection.centerY
      : activeSource.y;

    state.selection = {
      centerX: selectionCenterX,
      centerY: selectionCenterY,
      cropSize
    };

    this.#renderManualTokenPreview(state);
    if (typeof state.alphaRefreshControls === "function") {
      state.alphaRefreshControls();
    }
    if (state.zoomValueEl) state.zoomValueEl.textContent = `${state.zoom.toFixed(2)}x`;
  }

  #clearManualTokenPreview(state) {
    const previewCanvas = state.previewCanvas;
    if (!previewCanvas) return;

    const { width, height, dpr } = this.#syncCanvasResolution(previewCanvas);
    const ctx = previewCanvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
  }

  #renderManualTokenPreview(state) {
    const previewCanvas = state.previewCanvas;
    if (!previewCanvas || !state.selection) return;

    const { width, height, dpr } = this.#syncCanvasResolution(previewCanvas);
    const ctx = previewCanvas.getContext("2d");
    if (!ctx) return;

    const service = AutoTokenService.instance();
    const tokenCanvas = service.createTokenCanvasFromSelection({
      image: state.image,
      centerX: state.selection.centerX,
      centerY: state.selection.centerY,
      cropSize: state.selection.cropSize,
      alphaPolygons: state.alphaAppliedPolygons
    });

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(tokenCanvas, 0, 0, width, height);
  }

  #loadImageElement(source) {
    if (source instanceof HTMLImageElement && source.complete && source.naturalWidth > 0) {
      return Promise.resolve(source);
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = async () => {
        try {
          await img.decode();
        } catch (_e) {
          // ignore decode errors, use onload fallback
        }
        resolve(img);
      };
      img.onerror = () => reject(new Error(`[MTA] Image load failed: ${source}`));
      img.src = typeof source === "string" ? source : source.src;
    });
  }

  async #createAutoTokenPathFromSource(src, service) {
    const { blob } = await service.createTokenBlob(src, 2.5);
    if (!blob) return null;

    const file = this.#buildGeneratedTokenFile(blob, src, { generationMode: "auto" });
    return uploadFileToActorFolder(file, this.actor);
  }

  #buildGeneratedTokenImage(uploadedPath, sort = 0) {
    return {
      id: foundry.utils.randomID(),
      src: uploadedPath,
      scaleX: this.actor?.prototypeToken?.texture?.scaleX ?? 1,
      scaleY: this.actor?.prototypeToken?.texture?.scaleY ?? 1,
      sort,
      isDefault: false,
      autoEnable: {
        enabled: false,
        wounded: false,
        woundedPercent: 50,
        die: false
      },
      customScript: "",
      dynamicRing: {
        enabled: true,
        scaleCorrection: 1,
        ringColor: "#ffffff",
        backgroundColor: "#000000"
      }
    };
  }

  async #onCreateTokenForAll(event) {
    const imageType = event.currentTarget?.dataset?.imageType ?? IMAGE_TYPES.TOKEN;
    const data = getActorModuleData(this.actor);
    const service = AutoTokenService.instance();

    if (imageType === IMAGE_TYPES.PORTRAIT) {
      const portraitList = sortImagesByOrder(data.portraitImages ?? []);
      const tokenList = sortImagesByOrder(data.tokenImages ?? []);

      if (!portraitList.length) {
        ui.notifications.warn("Нет Portrait-изображений для пакетной обработки.");
        return;
      }

      let created = 0;
      let skipped = 0;
      let errors = 0;

      for (let portraitIndex = 0; portraitIndex < portraitList.length; portraitIndex += 1) {
        const portraitImage = portraitList[portraitIndex];
        const src = portraitImage?.src;

        if (!src || src === "icons/svg/mystery-man.svg") {
          skipped += 1;
          continue;
        }

        if (tokenList.length >= IMAGE_LIMIT) {
          skipped += portraitList.length - portraitIndex;
          break;
        }

        try {
          const uploadedPath = await this.#createAutoTokenPathFromSource(src, service);
          if (!uploadedPath) {
            errors += 1;
            continue;
          }

          const insertIndex = Math.min(Math.max(0, portraitIndex), tokenList.length);
          const tokenImage = this.#buildGeneratedTokenImage(uploadedPath, insertIndex);

          tokenList.splice(insertIndex, 0, tokenImage);
          created += 1;
        } catch (err) {
          console.error("[MTA AutoToken] Batch create from portrait error:", { src, err });
          errors += 1;
        }
      }

      tokenList.forEach((image, index) => {
        image.sort = index;
      });

      if (tokenList.length > 0 && !tokenList.some((image) => image?.isDefault)) {
        tokenList[0].isDefault = true;
      }

      data.tokenImages = tokenList;
      await setActorModuleData(this.actor, data);

      ui.notifications.info(`✅ Пакетная генерация из портретов завершена. Создано: ${created}, Пропущено: ${skipped}, Ошибок: ${errors}.`);
      this.render();
      return;
    }

    const list = data.tokenImages ?? [];

    if (!list.length) {
      ui.notifications.warn("Нет Token-изображений для пакетной обработки.");
      return;
    }

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const image of list) {
      const src = image?.src;

      // Skip placeholders
      if (!src || src === "icons/svg/mystery-man.svg") {
        skipped += 1;
        continue;
      }

      // Skip already generated auto-tokens
      if (typeof src === "string" && src.toLowerCase().endsWith("_token.webp")) {
        skipped += 1;
        continue;
      }

      try {
        const uploadedPath = await this.#createAutoTokenPathFromSource(src, service);
        if (!uploadedPath) {
          errors += 1;
          continue;
        }

        image.src = uploadedPath;
        image.dynamicRing = {
          enabled: true,
          scaleCorrection: 1,
          ringColor: "#ffffff",
          backgroundColor: "#000000"
        };

        created += 1;
      } catch (err) {
        console.error("[MTA AutoToken] Batch create error:", { src, err });
        errors += 1;
      }
    }

    await setActorModuleData(this.actor, data);

    ui.notifications.info(`✅ Пакетная генерация завершена. Создано: ${created}, Пропущено: ${skipped}, Ошибок: ${errors}.`);
    this.render();
  }
}
