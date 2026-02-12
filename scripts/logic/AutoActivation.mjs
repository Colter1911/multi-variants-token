import { MODULE_ID, TOKEN_FLAG_KEYS } from "../constants.mjs";
import { getActorModuleData } from "../utils/flag-utils.mjs";
import { resolveHpData } from "../utils/hp-resolver.mjs";
import { applyAutoRotate } from "./AutoRotate.mjs";
import { getDynamicRingUpdate, getRestoreRingUpdate } from "./DynamicRing.mjs";


export async function runAutoActivation({ actor, tokenDocument }) {
  if (!actor || !tokenDocument) return;

  const data = getActorModuleData(actor);
  // const hp = resolveHpData(actor); // Not strictly needed here if selectImageForHp re-resolves or we pass it? 
  // actually selectImageForHp calculates hp itself in the new logic I designed.

  // Checking for random mode
  if (data.global.tokenRandom) {
    // Random mode logic... existing code had it but it was complex.
    // For now, let's assume random mode is handled elsewhere or via selectImageForHp if needed?
    // Wait, the previous code had specific random headers.
    // Let's simplified it to just use selectImageForHp for now to FIX THE BUG.
    // If random mode is active, selectImageForHp might not be enough?
    // Actually, let's check the old code... 
    // It called selectImageForHp with images list.
  }

  // Debug Logging
  const currentActiveId = tokenDocument.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_TOKEN_IMAGE_ID);
  const selection = selectImageForHp({ actor, tokenDocument });

  console.log("[MTA-DEBUG] runAutoActivation", {
    tokenName: tokenDocument.name,
    currentActiveId,
    selectionId: selection?.id,
    hp: actor.system.attributes.hp.value
  });

  if (selection && selection.id !== currentActiveId) {
    console.log("[MTA-DEBUG] Applying selection", selection.src);
    await applyTokenImageById({ actor, tokenDocument, imageId: selection.id });
  }

  // Auto Rotate
  if (data.global.autoRotate) {
    const hp = resolveHpData(actor);
    await applyAutoRotate({ tokenDocument, shouldRotate: hp.current <= 0 });
  }
}

export function selectImageForHp({ actor, tokenDocument }) {
  const data = getActorModuleData(actor);
  const images = data.tokenImages;

  // Safety check
  if (!images || !images.length) return null;

  const hp = resolveHpData(actor);
  const hpValue = hp.current;
  const hpMax = hp.max;
  const hpPercent = hp.percent;

  // Logic: Find the highest priority matching image
  // 1. DEAD (HP <= 0)
  const die = images.filter(i => i.autoEnable?.enabled && i.autoEnable?.die && hpValue <= 0);

  // 2. WOUNDED (HP > 0 but <= threshold)
  const wounded = images.filter(i => i.autoEnable?.enabled && i.autoEnable?.wounded && hpValue > 0 && hpPercent <= (i.autoEnable.woundedPercent || 50));

  if (die.length) {
    console.log("[MTA-DEBUG] Found DIE image", die[0].id);
    return die[0];
  }
  if (wounded.length) {
    console.log("[MTA-DEBUG] Found WOUNDED image", wounded[0].id);
    return wounded[0];
  }

  // 2. Manual Image Check
  // If we are NOT in a special state, we check if the current image is a manual selection that should be preserved.
  const activeId = tokenDocument.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_TOKEN_IMAGE_ID);
  const activeImg = images.find(i => i.id === activeId);

  if (activeImg) {
    // Is the current image "Special" (Wounded/Die)?
    const isSpecialInfo = activeImg.autoEnable?.enabled && (activeImg.autoEnable?.die || activeImg.autoEnable?.wounded);

    // If it's NOT special, and valid, we keep it (Manual override persistence)
    if (!isSpecialInfo) {
      console.log("[MTA-DEBUG] Keeping current manual image", activeImg.src);
      return activeImg;
    }

    // HEALING LOGIC:
    // If we ARE currently on a special image, but we are no longer in that state (e.g. healed above 0 or wounded threshold),
    // The code above (die.length/wounded.length) would have already caught us if we were still in state.
    // If we reached here, it means we are "Healthy" relative to the current image's triggers.
    // So we should try to restore the "Pre-Condition" image.
    const preConditionId = tokenDocument.getFlag(MODULE_ID, "preConditionImageId");
    if (preConditionId) {
      const preImg = images.find(i => i.id === preConditionId);
      if (preImg) {
        console.log("[MTA-DEBUG] Restoring Pre-Condition Image", preImg.src);
        return preImg;
      }
    }
  }

  // 3. Fallback to Default
  const defaultImage = images.find(i => i.isDefault) ?? null;
  console.log("[MTA-DEBUG] Returning default image", defaultImage?.src);
  return defaultImage;
}

export async function applyTokenImageById({ actor, tokenDocument, imageId }) {
  if (!actor || !tokenDocument || !imageId) return;

  const data = getActorModuleData(actor);
  const image = data.tokenImages.find((it) => it.id === imageId);
  if (!image) return;

  console.log("[MTA] Applying TOKEN image", { imageId, src: image.src });

  let updates = {
    "texture.src": image.src,
    "texture.scaleX": image.scaleX ?? 1,
    "texture.scaleY": image.scaleY ?? 1,
    [`flags.${MODULE_ID}.${TOKEN_FLAG_KEYS.ACTIVE_TOKEN_IMAGE_ID}`]: imageId
  };

  const updateOptions = {
    animation: { duration: 0 }, // Disable animation to prevent scale glitches during renderer switch
    mtaManualUpdate: true
  };

  // Check if we are switching TO a special image FROM a normal image
  // If so, save the current normal image as "Pre-Condition" image to restore later.
  const currentActiveId = tokenDocument.getFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_TOKEN_IMAGE_ID);
  const currentImage = data.tokenImages.find(i => i.id === currentActiveId);

  if (image.autoEnable?.enabled && currentImage && !currentImage.autoEnable?.enabled) {
    updates[`flags.${MODULE_ID}.preConditionImageId`] = currentActiveId;
  } else if (!image.autoEnable?.enabled) {
    updates[`flags.${MODULE_ID}.preConditionImageId`] = null;
  }

  // Calculate Dynamic Ring Updates (Atomic Merge)
  let ringUpdates = {};
  if (image.dynamicRing?.enabled) {
    // Import these helper functions dynamically or ensure they are imported at top
    ringUpdates = getDynamicRingUpdate(tokenDocument, image.dynamicRing);
  } else {
    ringUpdates = getRestoreRingUpdate(tokenDocument);
  }

  // Merge ring updates into main updates
  if (ringUpdates && !foundry.utils.isEmpty(ringUpdates)) {
    updates = foundry.utils.mergeObject(updates, ringUpdates);
  }

  // Perform ONE single atomic update
  await tokenDocument.update(updates, updateOptions);

  if (tokenDocument.object) {
    tokenDocument.object.refresh();
  }
}

export async function applyPortraitById({ actor, tokenDocument, imageId }) {
  if (!actor || !tokenDocument || !imageId) return;

  const data = getActorModuleData(actor);
  const image = data.portraitImages.find((it) => it.id === imageId);
  if (!image) return;

  console.log("[MTA] Applying PORTRAIT image", { imageId, src: image.src });

  await actor.update({ img: image.src });
  await tokenDocument.setFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_PORTRAIT_IMAGE_ID, imageId);
}
