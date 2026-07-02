import { MANUAL_DYNAMIC_RING_FIT_FACTOR, MODULE_ID, MTA_EFFECT_ATTRIBUTES, TOKEN_FLAG_KEYS } from "../constants.mjs";
import { getTokenStatusValues, hasMatchingStatus } from "../system-support.mjs";
import { getActorModuleData } from "../utils/flag-utils.mjs";
import { resolveHpData } from "../utils/hp-resolver.mjs";
import { applyAutoRotate } from "./AutoRotate.mjs";
import { getDynamicRingUpdate, getRestoreRingUpdate, getDisableRingUpdate } from "./DynamicRing.mjs";
import { sortImagesByOrder } from "./RandomMode.mjs";

const MANUAL_RING_INNER_SCALE = 0.85;

function computeManualRingSubjectScaleCorrection(manualToken) {
  const selection = manualToken?.selection;
  const cropSize = Number(selection?.cropSize);
  const centerX = Number(selection?.centerX);
  const centerY = Number(selection?.centerY);
  if (!Number.isFinite(cropSize) || cropSize <= 0 || !Number.isFinite(centerX) || !Number.isFinite(centerY)) return 1;

  const baseCanvasSize = 512;
  const innerSize = baseCanvasSize * MANUAL_RING_INNER_SCALE;
  const innerRadius = innerSize / 2;
  const canvasCenter = baseCanvasSize / 2;
  const sourceToTokenScale = innerSize / cropSize;
  const sx = centerX - (cropSize / 2);
  const sy = centerY - (cropSize / 2);
  const offset = (baseCanvasSize - innerSize) / 2;

  let radius = innerRadius;
  const polygons = Array.isArray(manualToken?.alphaPolygons) ? manualToken.alphaPolygons : [];
  for (const polygon of polygons) {
    if (polygon?.operation === "subtract" || !Array.isArray(polygon?.points)) continue;
    for (const point of polygon.points) {
      const x = Number(point?.x);
      const y = Number(point?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const mappedX = offset + ((x - sx) * sourceToTokenScale);
      const mappedY = offset + ((y - sy) * sourceToTokenScale);
      radius = Math.max(radius, Math.abs(mappedX - canvasCenter), Math.abs(mappedY - canvasCenter));
    }
  }

  const ringContentRatio = radius / Math.max(1, innerRadius);
  return ringContentRatio > 1.0001
    ? Math.max(1, ringContentRatio * MANUAL_DYNAMIC_RING_FIT_FACTOR)
    : 1;
}

function isManualDynamicRingOverflowImage(image) {
  return Boolean(image?.manualToken?.render && !image.manualToken.render.customFrameEnabled);
}

function resolveAppliedTextureScale(image, axis) {
  const storedScale = Number(image?.[axis]);
  const safeStoredScale = Number.isFinite(storedScale) ? storedScale : 1;

  if (!isManualDynamicRingOverflowImage(image)) return safeStoredScale;

  const render = image.manualToken.render;
  const textureScale = Number(render.textureScale);
  if (!Number.isFinite(textureScale) || textureScale <= 0) return safeStoredScale;

  if (render.textureScaleAppliedToStoredScale === false) {
    return safeStoredScale * textureScale;
  }

  return safeStoredScale;
}

function getLinkedPortraitByTokenImage({ actorData, tokenImageId }) {
  if (!actorData?.global?.linkTokenPortrait) return null;
  if (!tokenImageId) return null;

  const sortedTokens = sortImagesByOrder(actorData.tokenImages ?? []);
  const sortedPortraits = sortImagesByOrder(actorData.portraitImages ?? []);
  if (!sortedTokens.length || !sortedPortraits.length) return null;

  const tokenIndex = sortedTokens.findIndex((image) => image.id === tokenImageId);
  if (tokenIndex < 0) return null;

  return sortedPortraits[tokenIndex] ?? null;
}

function normalizeEffectChangeKey(key) {
  return String(key ?? "").trim().toLowerCase();
}

function getEffectChanges(effect) {
  return Array.isArray(effect?.changes) ? effect.changes : [];
}

function parseImageIndex(value) {
  const index = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(index) && index > 0 ? index : null;
}

function getImageByIndex(imageList, index) {
  if (!index) return null;
  return sortImagesByOrder(imageList ?? [])[index - 1] ?? null;
}

export function activeEffectHasMtaImageOverride(effect) {
  return getEffectChanges(effect).some((change) => {
    const key = normalizeEffectChangeKey(change?.key);
    return key === MTA_EFFECT_ATTRIBUTES.TOKEN_IMAGE_INDEX
      || key === MTA_EFFECT_ATTRIBUTES.PORTRAIT_IMAGE_INDEX;
  });
}

function getActiveEffectImageOverrideIndexes(actor) {
  const result = { tokenIndex: null, portraitIndex: null };
  const effects = actor?.effects;
  if (!effects) return result;

  for (const effect of effects) {
    if (effect?.disabled) continue;

    for (const change of getEffectChanges(effect)) {
      const key = normalizeEffectChangeKey(change?.key);
      const index = parseImageIndex(change?.value);
      if (!index) continue;

      if (key === MTA_EFFECT_ATTRIBUTES.TOKEN_IMAGE_INDEX) {
        result.tokenIndex = index;
      } else if (key === MTA_EFFECT_ATTRIBUTES.PORTRAIT_IMAGE_INDEX) {
        result.portraitIndex = index;
      }
    }
  }

  return result;
}

function getTokenTextureSrc(tokenDocument) {
  return tokenDocument?.texture?.src ?? null;
}

export function isExternalTokenImageOverrideActive(tokenDocument) {
  if (!tokenDocument) return false;

  const externalSrc = tokenDocument.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.EXTERNAL_TOKEN_IMAGE_SRC);
  if (!externalSrc) return false;

  return getTokenTextureSrc(tokenDocument) === externalSrc;
}

async function updateTokenOverrideFlags(tokenDocument, updates) {
  if (!tokenDocument || foundry.utils.isEmpty(updates)) return;
  await tokenDocument.update(updates, { mtaManualUpdate: true });
}

export async function handleExternalTokenImageChange({ actor, tokenDocument, newSrc }) {
  if (!actor || !tokenDocument) return null;

  const nextSrc = typeof newSrc === "string" ? newSrc : "";
  if (!nextSrc) return null;

  const data = getActorModuleData(actor);
  const tokenImages = data.tokenImages ?? [];
  const matchedImage = tokenImages.find((image) => image?.src === nextSrc) ?? null;
  const currentActiveId = tokenDocument.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_TOKEN_IMAGE_ID);
  const managedSrc = tokenDocument.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.MANAGED_TOKEN_IMAGE_SRC);
  const externalSrc = tokenDocument.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.EXTERNAL_TOKEN_IMAGE_SRC);
  const preExternalId = tokenDocument.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.PRE_EXTERNAL_TOKEN_IMAGE_ID);

  if (matchedImage) {
    await updateTokenOverrideFlags(tokenDocument, {
      [`flags.${MODULE_ID}.${TOKEN_FLAG_KEYS.ACTIVE_TOKEN_IMAGE_ID}`]: matchedImage.id,
      [`flags.${MODULE_ID}.${TOKEN_FLAG_KEYS.MANAGED_TOKEN_IMAGE_SRC}`]: matchedImage.src,
      [`flags.${MODULE_ID}.${TOKEN_FLAG_KEYS.EXTERNAL_TOKEN_IMAGE_SRC}`]: null,
      [`flags.${MODULE_ID}.${TOKEN_FLAG_KEYS.PRE_EXTERNAL_TOKEN_IMAGE_ID}`]: null
    });
    return { matchedModuleImage: true, reset: Boolean(externalSrc), imageId: matchedImage.id };
  }

  if (managedSrc && nextSrc === managedSrc) {
    await updateTokenOverrideFlags(tokenDocument, {
      [`flags.${MODULE_ID}.${TOKEN_FLAG_KEYS.EXTERNAL_TOKEN_IMAGE_SRC}`]: null,
      [`flags.${MODULE_ID}.${TOKEN_FLAG_KEYS.PRE_EXTERNAL_TOKEN_IMAGE_ID}`]: null
    });
    return { reset: Boolean(externalSrc) };
  }

  const storedPreExternalId = preExternalId ?? currentActiveId ?? null;
  await updateTokenOverrideFlags(tokenDocument, {
    [`flags.${MODULE_ID}.${TOKEN_FLAG_KEYS.EXTERNAL_TOKEN_IMAGE_SRC}`]: nextSrc,
    [`flags.${MODULE_ID}.${TOKEN_FLAG_KEYS.PRE_EXTERNAL_TOKEN_IMAGE_ID}`]: storedPreExternalId
  });

  return { external: true };
}


export async function runAutoActivation({
  actor,
  tokenDocument,
  forceTokenImageUpdate = false,
  forcePortraitImageUpdate = false,
  ignoreManualSelection = false
}) {
  if (!actor || !tokenDocument) return;

  const data = getActorModuleData(actor);
  const effectOverrides = getActiveEffectImageOverrideIndexes(actor);
  let selectedTokenImageId = null;

  // 1. Process TOKEN Images
  const currentTokenId = tokenDocument.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_TOKEN_IMAGE_ID);
  const externalTokenOverrideActive = isExternalTokenImageOverrideActive(tokenDocument);

  if (externalTokenOverrideActive) {
    selectedTokenImageId = currentTokenId ?? null;
  } else {
    const tokenSelection = getImageByIndex(data.tokenImages, effectOverrides.tokenIndex)
      ?? findBestImageForHp({
        actor,
        tokenDocument,
        imageList: data.tokenImages,
        activeId: currentTokenId,
        preConditionFlagKey: "preConditionImageId",
        ignoreManualSelection
      });

    if (tokenSelection && (forceTokenImageUpdate || tokenSelection.id !== currentTokenId)) {
      console.log("[MTA-DEBUG] Auto-Activating Token Image", tokenSelection.src);
      // Pass the selection object directly to avoid race conditions with setting flags
      await applyTokenImageById({ actor, tokenDocument, imageObject: tokenSelection });
      selectedTokenImageId = tokenSelection.id;
    } else {
      selectedTokenImageId = currentTokenId ?? tokenSelection?.id ?? null;
    }
  }

  // 2. Process PORTRAIT Images
  const currentPortraitId = tokenDocument.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_PORTRAIT_IMAGE_ID);
  const portraitOverride = getImageByIndex(data.portraitImages, effectOverrides.portraitIndex);
  const linkedPortrait = externalTokenOverrideActive
    ? null
    : getLinkedPortraitByTokenImage({
      actorData: data,
      tokenImageId: selectedTokenImageId
    });

  if (portraitOverride) {
    if (forcePortraitImageUpdate || portraitOverride.id !== currentPortraitId) {
      console.log("[MTA-DEBUG] Active Effect Portrait activation", portraitOverride.src);
      await applyPortraitById({ actor, tokenDocument, imageObject: portraitOverride });
    }
  } else if (data.global.linkTokenPortrait) {
    // Link mode: portrait follows token by visual order.
    // If no portrait pair exists for the selected token index, keep current portrait unchanged.
    if (linkedPortrait && linkedPortrait.id !== currentPortraitId) {
      console.log("[MTA-DEBUG] Linked Portrait activation", linkedPortrait.src);
      await applyPortraitById({ actor, tokenDocument, imageObject: linkedPortrait });
    }
  } else {
    const portraitSelection = findBestImageForHp({
      actor,
      tokenDocument,
      imageList: data.portraitImages,
      activeId: currentPortraitId,
      preConditionFlagKey: "preConditionPortraitId",
      ignoreManualSelection
    });

    if (portraitSelection && (forcePortraitImageUpdate || portraitSelection.id !== currentPortraitId)) {
      console.log("[MTA-DEBUG] Auto-Activating Portrait Image", portraitSelection.src);
      await applyPortraitById({ actor, tokenDocument, imageObject: portraitSelection });
    }
  }

  // Auto Rotate
  const hp = resolveHpData(actor);
  if (data.global.autoRotate) {
    await applyAutoRotate({ tokenDocument, shouldRotate: hp.current <= 0 });
  }
}

/**
 * Generic function to find the best image based on HP state
 */
export function findBestImageForHp({ actor, tokenDocument, imageList, activeId, preConditionFlagKey, ignoreManualSelection = false }) {
  // Safety check
  if (!imageList || !imageList.length) return null;

  const hp = resolveHpData(actor);
  const hpValue = hp.current;
  const hpPercent = hp.percent;
  const getWoundedThreshold = (image) => Number(image?.autoEnable?.woundedPercent ?? 50);

  const tokenStatuses = getTokenStatusValues(tokenDocument);
  const hasStatusMatch = (image) => {
    if (!image?.autoEnable?.enabled) return false;

    const wantedStatus = String(image.autoEnable?.status ?? "").trim();
    if (!wantedStatus) return false;

    return hasMatchingStatus(tokenStatuses, wantedStatus);
  };

  // Logic: Find the highest priority matching image
  // 1. DEAD (HP <= 0)
  const die = imageList.filter(i => i.autoEnable?.enabled && i.autoEnable?.die && hpValue <= 0);

  // 2. STATUS (selected status is present on token)
  const statusMatched = imageList.filter((i) => hasStatusMatch(i));

  // 3. WOUNDED (HP <= threshold)
  // FIX: Removed 'hpValue > 0' check. 
  // This allows Wounded images to be selected even at 0 HP if no explicit Die image exists.
  const wounded = imageList
    .filter((i) => i.autoEnable?.enabled && i.autoEnable?.wounded && hpPercent <= getWoundedThreshold(i))
    .sort((a, b) => {
      const thresholdDiff = getWoundedThreshold(a) - getWoundedThreshold(b);
      if (thresholdDiff !== 0) return thresholdDiff;
      return Number(a?.sort ?? 0) - Number(b?.sort ?? 0);
    });

  if (die.length) {
    return die[0];
  }
  if (statusMatched.length) {
    return statusMatched[0];
  }
  if (wounded.length) {
    // Return the most severe wounded match first.
    // Example: at 5% HP, the 10% variant should override the 50% variant.
    return wounded[0];
  }

  // 2. Manual Image Check (Persistence)
  const activeImg = imageList.find(i => i.id === activeId);

  if (activeImg && !ignoreManualSelection) {
    // Is the current image "Special" (Die/Status/Wounded)?
    const hasConfiguredStatus = Boolean(String(activeImg.autoEnable?.status ?? "").trim());
    const isSpecialInfo = activeImg.autoEnable?.enabled
      && (activeImg.autoEnable?.die || activeImg.autoEnable?.wounded || hasConfiguredStatus);

    // If it's NOT special, and valid, we keep it (Manual override persistence)
    if (!isSpecialInfo) {
      return activeImg;
    }

    // HEALING LOGIC:
    // We are currently on a special image, but we are no longer in that special state (healed).
    // Try to restore the "Pre-Condition" image.
    const preConditionId = tokenDocument.getFlag(MODULE_ID, preConditionFlagKey);
    if (preConditionId) {
      const preImg = imageList.find(i => i.id === preConditionId);
      if (preImg) {
        return preImg;
      }
    }
  }

  // 3. Fallback to Default
  const defaultImage = imageList.find(i => i.isDefault) ?? null;
  return defaultImage;
}

export async function applyTokenImageById({ actor, tokenDocument, imageId, imageObject = null }) {
  if (!actor) return;

  let image = imageObject;
  const data = getActorModuleData(actor);

  if (!image) {
    if (!imageId) return;
    image = data.tokenImages.find((it) => it.id === imageId);
  }

  if (!image) return;

  console.log("[MTA] Applying TOKEN image", { imageId: image.id, src: image.src });

  const linkedPortrait = getLinkedPortraitByTokenImage({
    actorData: data,
    tokenImageId: image.id
  });

  const appliedTextureScaleX = resolveAppliedTextureScale(image, "scaleX");
  const appliedTextureScaleY = resolveAppliedTextureScale(image, "scaleY");

  // Actor-only context (e.g. manager opened from actor sheet without placed token).
  // Apply to prototype token so future placed tokens inherit the selection.
  if (!tokenDocument) {
    await actor.update({
      "prototypeToken.texture.src": image.src,
      "prototypeToken.texture.scaleX": appliedTextureScaleX,
      "prototypeToken.texture.scaleY": appliedTextureScaleY,
      [`flags.${MODULE_ID}.${TOKEN_FLAG_KEYS.ACTIVE_TOKEN_IMAGE_ID}`]: image.id
    });

    if (linkedPortrait) {
      await applyPortraitById({ actor, tokenDocument: null, imageObject: linkedPortrait });
    }

    return;
  }

  let updates = {
    "texture.src": image.src,
    "texture.scaleX": appliedTextureScaleX,
    "texture.scaleY": appliedTextureScaleY,
    [`flags.${MODULE_ID}.${TOKEN_FLAG_KEYS.ACTIVE_TOKEN_IMAGE_ID}`]: image.id,
    [`flags.${MODULE_ID}.${TOKEN_FLAG_KEYS.MANAGED_TOKEN_IMAGE_SRC}`]: image.src,
    [`flags.${MODULE_ID}.${TOKEN_FLAG_KEYS.EXTERNAL_TOKEN_IMAGE_SRC}`]: null,
    [`flags.${MODULE_ID}.${TOKEN_FLAG_KEYS.PRE_EXTERNAL_TOKEN_IMAGE_ID}`]: null
  };

  const updateOptions = {
    animation: { duration: 0 }, // Disable animation to prevent scale glitches
    mtaManualUpdate: true
  };

  // Pre-Condition Logic
  const currentActiveId = tokenDocument.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_TOKEN_IMAGE_ID);
  const currentImage = data.tokenImages.find(i => i.id === currentActiveId);

  if (image.autoEnable?.enabled && currentImage && !currentImage.autoEnable?.enabled) {
    updates[`flags.${MODULE_ID}.preConditionImageId`] = currentActiveId;
  } else if (!image.autoEnable?.enabled) {
    updates[`flags.${MODULE_ID}.preConditionImageId`] = null;
  }

  // FORCE UPDATE
  updates[`flags.${MODULE_ID}.${TOKEN_FLAG_KEYS.LAST_UPDATE}`] = Date.now();

  // Dynamic Ring
  let ringUpdates = {};
  if (image.dynamicRing?.enabled) {
    const ringConfig = foundry.utils.deepClone(image.dynamicRing);
    const isManualDynamicRingOverflow = isManualDynamicRingOverflowImage(image);

    if (isManualDynamicRingOverflow) {
      const ringSubjectScaleCorrection = Number(image.manualToken.render.ringSubjectScaleCorrection);
      ringConfig.subjectScaleCorrection = Number.isFinite(ringSubjectScaleCorrection) && ringSubjectScaleCorrection > 0
        ? ringSubjectScaleCorrection
        : computeManualRingSubjectScaleCorrection(image.manualToken);
    }

    ringUpdates = getDynamicRingUpdate(tokenDocument, ringConfig);
  } else {
    ringUpdates = getDisableRingUpdate(tokenDocument);
  }

  if (ringUpdates && !foundry.utils.isEmpty(ringUpdates)) {
    updates = foundry.utils.mergeObject(updates, ringUpdates);
  }

  await tokenDocument.update(updates, updateOptions);

  if (tokenDocument.object) {
    tokenDocument.object.refresh();
  }

  // Linked token: persist token image selection to actor/prototype so changes are shared.
  const isLinkedToken = Boolean(tokenDocument.actorLink ?? tokenDocument.isLinked);
  if (isLinkedToken) {
    try {
      await actor.update({
        "prototypeToken.texture.src": image.src,
        "prototypeToken.texture.scaleX": appliedTextureScaleX,
        "prototypeToken.texture.scaleY": appliedTextureScaleY,
        [`flags.${MODULE_ID}.${TOKEN_FLAG_KEYS.ACTIVE_TOKEN_IMAGE_ID}`]: image.id
      }, { mtaManualUpdate: true });
    } catch (error) {
      console.warn("[MTA] Failed to sync linked token image to actor", {
        actorId: actor?.id,
        actorName: actor?.name,
        tokenId: tokenDocument?.id,
        error
      });
    }
  }

  if (linkedPortrait) {
    const currentPortraitId = tokenDocument.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_PORTRAIT_IMAGE_ID);
    if (linkedPortrait.id !== currentPortraitId) {
      await applyPortraitById({ actor, tokenDocument, imageObject: linkedPortrait });
    }
  }
}

export async function applyPortraitById({ actor, tokenDocument, imageId, imageObject = null }) {
  if (!actor) return;

  let image = imageObject;
  const data = getActorModuleData(actor);

  if (!image) {
    if (!imageId) return;
    image = data.portraitImages.find((it) => it.id === imageId);
  }

  if (!image) return;

  console.log("[MTA] Applying PORTRAIT image", { imageId: image.id, src: image.src });

  // Pre-Condition logic is token-specific, so only apply if tokenDocument is present.
  let updates = {};
  if (tokenDocument) {
    const currentActiveId = tokenDocument.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_PORTRAIT_IMAGE_ID);
    const currentImage = data.portraitImages.find(i => i.id === currentActiveId);

    // We need to store this flag as well
    if (image.autoEnable?.enabled && currentImage && !currentImage.autoEnable?.enabled) {
      updates[`flags.${MODULE_ID}.preConditionPortraitId`] = currentActiveId;
    } else if (!image.autoEnable?.enabled) {
      updates[`flags.${MODULE_ID}.preConditionPortraitId`] = null;
    }

    // Update active portrait flag for token context.
    updates[`flags.${MODULE_ID}.${TOKEN_FLAG_KEYS.ACTIVE_PORTRAIT_IMAGE_ID}`] = image.id;
  }

  // Since we are updating Actor, we might not need to update Token flags via tokenDocument.update for the actor image,
  // BUT we need to store the flags on the token document to persist state relative to that token's automation?
  // Actually, portraits are actor-level usually, but our logic runs via Token Document hooks.
  // Let's keep flags on Token Document to avoid polluting Actor if multiple tokens exist?
  // Wait, if we update Actor.img, it affects ALL tokens linked to it.
  // Standard Foundry behavior: Auto-activation usually drives the specific Token's appearance.
  // But Portrait is unique to the Actor.
  // If we change Actor.img, it changes for everyone.
  // That's acceptable for "Portrait" switching.

  const actorUpdates = { img: image.src };
  if (!tokenDocument) {
    actorUpdates[`flags.${MODULE_ID}.${TOKEN_FLAG_KEYS.ACTIVE_PORTRAIT_IMAGE_ID}`] = image.id;
  }

  // Idempotency: пропускаем обновление актора если портрет уже совпадает
  if (actor.img !== image.src) {
    await actor.update(actorUpdates);
  }

  // Apply flag updates to Token (to remember state)
  if (tokenDocument && !foundry.utils.isEmpty(updates)) {
    await tokenDocument.update(updates, { mtaManualUpdate: true });
  }
}
