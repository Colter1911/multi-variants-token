import { MODULE_ID, TOKEN_FLAG_KEYS } from "../constants.mjs";
import { getActorModuleData } from "../utils/flag-utils.mjs";
import { resolveHpData } from "../utils/hp-resolver.mjs";
import { applyAutoRotate } from "./AutoRotate.mjs";
import { getDynamicRingUpdate, getRestoreRingUpdate, getDisableRingUpdate } from "./DynamicRing.mjs";
import { sortImagesByOrder } from "./RandomMode.mjs";

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


export async function runAutoActivation({ actor, tokenDocument }) {
  if (!actor || !tokenDocument) return;

  const data = getActorModuleData(actor);
  let selectedTokenImageId = null;

  // 1. Process TOKEN Images
  const currentTokenId = tokenDocument.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_TOKEN_IMAGE_ID);
  const tokenSelection = findBestImageForHp({
    actor,
    tokenDocument,
    imageList: data.tokenImages,
    activeId: currentTokenId,
    preConditionFlagKey: "preConditionImageId"
  });

  if (tokenSelection && tokenSelection.id !== currentTokenId) {
    console.log("[MTA-DEBUG] Auto-Activating Token Image", tokenSelection.src);
    // Pass the selection object directly to avoid race conditions with setting flags
    await applyTokenImageById({ actor, tokenDocument, imageObject: tokenSelection });
    selectedTokenImageId = tokenSelection.id;
  } else {
    selectedTokenImageId = currentTokenId ?? tokenSelection?.id ?? null;
  }

  // 2. Process PORTRAIT Images
  const currentPortraitId = tokenDocument.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_PORTRAIT_IMAGE_ID);
  const linkedPortrait = getLinkedPortraitByTokenImage({
    actorData: data,
    tokenImageId: selectedTokenImageId
  });

  if (data.global.linkTokenPortrait) {
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
      preConditionFlagKey: "preConditionPortraitId"
    });

    if (portraitSelection && portraitSelection.id !== currentPortraitId) {
      console.log("[MTA-DEBUG] Auto-Activating Portrait Image", portraitSelection.src);
      await applyPortraitById({ actor, tokenDocument, imageObject: portraitSelection });
    }
  }

  // Auto Rotate
  if (data.global.autoRotate) {
    const hp = resolveHpData(actor);
    await applyAutoRotate({ tokenDocument, shouldRotate: hp.current <= 0 });
  }
}

/**
 * Generic function to find the best image based on HP state
 */
export function findBestImageForHp({ actor, tokenDocument, imageList, activeId, preConditionFlagKey }) {
  // Safety check
  if (!imageList || !imageList.length) return null;

  const hp = resolveHpData(actor);
  const hpValue = hp.current;
  const hpPercent = hp.percent;

  const getTokenStatuses = (tokenDoc) => {
    if (!tokenDoc) return [];

    const statuses = new Set();
    const pushStatus = (value) => {
      if (value === null || value === undefined) return;
      const label = String(value).trim();
      if (label) statuses.add(label);
    };

    const processEffect = (effect) => {
      if (!effect) return;

      pushStatus(effect?.name);
      pushStatus(effect?.label);
      pushStatus(effect?.statusId);
      pushStatus(effect?.slug);

      const statusesField = effect?.statuses;
      if (statusesField instanceof Set) {
        for (const entry of statusesField) pushStatus(entry);
      } else if (Array.isArray(statusesField)) {
        for (const entry of statusesField) pushStatus(entry);
      }

      const nestedStatus = effect?.statuses?.status;
      if (Array.isArray(nestedStatus)) {
        for (const entry of nestedStatus) pushStatus(entry);
      }

      const id = effect?._id ?? effect?.id;
      if (id && typeof tokenDoc.hasStatusEffect === "function") {
        try {
          if (tokenDoc.hasStatusEffect(id)) pushStatus(effect?.name ?? effect?.label ?? id);
        } catch (_err) {
          // ignore hasStatusEffect failures for malformed ids
        }
      }
    };

    const actorEffects = tokenDoc?.actor?.effects;
    if (actorEffects) {
      for (const effect of actorEffects) {
        if (effect?.disabled) continue;
        processEffect(effect);
      }
    }

    const tokenEffects = tokenDoc?.effects;
    if (Array.isArray(tokenEffects)) {
      for (const entry of tokenEffects) pushStatus(entry);
    }

    return Array.from(statuses);
  };

  const tokenStatuses = getTokenStatuses(tokenDocument);
  const hasStatusMatch = (image) => {
    if (!image?.autoEnable?.enabled) return false;

    const wantedStatus = String(image.autoEnable?.status ?? "").trim();
    if (!wantedStatus) return false;

    return tokenStatuses.some((statusValue) => statusValue.localeCompare(wantedStatus, undefined, { sensitivity: "accent" }) === 0);
  };

  // Logic: Find the highest priority matching image
  // 1. DEAD (HP <= 0)
  const die = imageList.filter(i => i.autoEnable?.enabled && i.autoEnable?.die && hpValue <= 0);

  // 2. STATUS (selected status is present on token)
  const statusMatched = imageList.filter((i) => hasStatusMatch(i));

  // 3. WOUNDED (HP <= threshold)
  // FIX: Removed 'hpValue > 0' check. 
  // This allows Wounded images to be selected even at 0 HP if no explicit Die image exists.
  const wounded = imageList.filter(i => i.autoEnable?.enabled && i.autoEnable?.wounded && hpPercent <= (i.autoEnable.woundedPercent || 50));

  if (die.length) {
    return die[0];
  }
  if (statusMatched.length) {
    return statusMatched[0];
  }
  if (wounded.length) {
    // If we are dead (0 HP) but have no Die image, we fall through here.
    // 'wounded' will contain images since 0 <= 50.
    // So we return the wounded image as fallback.
    return wounded[0];
  }

  // 2. Manual Image Check (Persistence)
  const activeImg = imageList.find(i => i.id === activeId);

  if (activeImg) {
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

  // Actor-only context (e.g. manager opened from actor sheet without placed token).
  // Apply to prototype token so future placed tokens inherit the selection.
  if (!tokenDocument) {
    await actor.update({
      "prototypeToken.texture.src": image.src,
      "prototypeToken.texture.scaleX": image.scaleX ?? 1,
      "prototypeToken.texture.scaleY": image.scaleY ?? 1,
      [`flags.${MODULE_ID}.${TOKEN_FLAG_KEYS.ACTIVE_TOKEN_IMAGE_ID}`]: image.id
    });

    if (linkedPortrait) {
      await applyPortraitById({ actor, tokenDocument: null, imageObject: linkedPortrait });
    }

    return;
  }

  let updates = {
    "texture.src": image.src,
    "texture.scaleX": image.scaleX ?? 1,
    "texture.scaleY": image.scaleY ?? 1,
    [`flags.${MODULE_ID}.${TOKEN_FLAG_KEYS.ACTIVE_TOKEN_IMAGE_ID}`]: image.id
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
    ringUpdates = getDynamicRingUpdate(tokenDocument, image.dynamicRing);
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
        "prototypeToken.texture.scaleX": image.scaleX ?? 1,
        "prototypeToken.texture.scaleY": image.scaleY ?? 1,
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

  await actor.update(actorUpdates);

  // Apply flag updates to Token (to remember state)
  if (tokenDocument && !foundry.utils.isEmpty(updates)) {
    await tokenDocument.update(updates, { mtaManualUpdate: true });
  }
}
