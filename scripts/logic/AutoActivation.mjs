import { MODULE_ID, TOKEN_FLAG_KEYS } from "../constants.mjs";
import { getActorModuleData } from "../utils/flag-utils.mjs";
import { resolveHpData } from "../utils/hp-resolver.mjs";
import { applyAutoRotate } from "./AutoRotate.mjs";
import { applyDynamicRing, restoreDynamicRing } from "./DynamicRing.mjs";

export async function runAutoActivation({ actor, tokenDocument }) {
  if (!actor || !tokenDocument) return;

  const data = getActorModuleData(actor);
  const hp = resolveHpData(actor);

  console.log("[Multi Token Art] runAutoActivation called", {
    actorName: actor.name,
    hp: hp.current,
    max: hp.max,
    percent: hp.percent,
    autoRotate: data.global.autoRotate
  });

  if (data.global.autoRotate) {
    await applyAutoRotate({ tokenDocument, shouldRotate: hp.current <= 0 });
  }

  if (!data.global.tokenRandom) {
    const selectedTokenImage = selectImageForHp({ images: data.tokenImages, actor, tokenDocument, hp });
    console.log("[MTA] Selected TOKEN image:", selectedTokenImage?.id);
    if (selectedTokenImage) {
      await applyTokenImageById({ actor, tokenDocument, imageId: selectedTokenImage.id });
    }
  }

  if (!data.global.portraitRandom) {
    const selectedPortrait = selectImageForHp({ images: data.portraitImages, actor, tokenDocument, hp });
    console.log("[MTA] Selected PORTRAIT image:", selectedPortrait?.id);
    if (selectedPortrait) {
      await applyPortraitById({ actor, tokenDocument, imageId: selectedPortrait.id });
    }
  }
}

export function selectImageForHp({ images = [], actor, tokenDocument, hp }) {
  console.log("[MTA] selectImageForHp called", { imagesCount: images.length, hp });

  const scripted = [];
  const wounded = [];
  const die = [];

  for (const image of images) {
    console.log("[MTA] Checking image", {
      imageId: image.id,
      autoEnable: image.autoEnable,
      autoEnableEnabled: image.autoEnable?.enabled,
      hpPercent: hp.percent,
      woundedPercent: image.autoEnable?.woundedPercent,
      hpCurrent: hp.current
    });

    // Custom script takes priority
    if (image.customScript && image.customScript.trim() !== "") {
      try {
        const evalFunc = new Function("actor", "tokenDocument", "hp", image.customScript);
        const result = evalFunc(actor, tokenDocument, hp);
        if (result === true) {
          console.log("[MTA] Custom script returned true for image", image.id);
          scripted.push(image);
          continue;
        }
      } catch (error) {
        console.error(`[MTA] Error evaluating custom script for image ${image.id}:`, error);
      }
    }

    // Only check autoEnable conditions if enabled
    if (image.autoEnable?.enabled) {
      console.log("[MTA] autoEnable is enabled for image", image.id);

      if (image.autoEnable.wounded && hp.percent <= Number(image.autoEnable.woundedPercent ?? 50) && hp.current > 0) {
        console.log("[MTA] Image qualifies as WOUNDED", {
          imageId: image.id,
          woundedPercent: image.autoEnable.woundedPercent,
          hpPercent: hp.percent
        });
        wounded.push(image);
        continue;
      }

      if (image.autoEnable.die && hp.current <= 0) {
        console.log("[MTA] Image qualifies as DIE", image.id);
        die.push(image);
      }
    } else {
      console.log("[MTA] autoEnable is NOT enabled for image", image.id);
    }
  }

  console.log("[MTA] Categories:", {
    scripted: scripted.length,
    wounded: wounded.length,
    die: die.length
  });

  if (scripted.length) {
    console.log("[MTA] Returning scripted image", scripted[0].id);
    return scripted[0];
  }

  // ИСПРАВЛЕНО: Приоритет Die при HP=0
  if (hp.current <= 0 && die.length) {
    const selected = die[Math.floor(Math.random() * die.length)];
    console.log("[MTA] Returning die image (HP=0)", selected.id);
    return selected;
  }

  // Если есть wounded картинки (включая случай HP=0 но die выключен)
  if (wounded.length) {
    wounded.sort((a, b) => Number(a.autoEnable.woundedPercent) - Number(b.autoEnable.woundedPercent));
    const bestThreshold = Number(wounded[0].autoEnable.woundedPercent);
    const tied = wounded.filter((image) => Number(image.autoEnable.woundedPercent) === bestThreshold);
    const selected = tied[Math.floor(Math.random() * tied.length)];
    console.log("[MTA] Returning wounded image", selected.id);
    return selected;
  }

  const defaultImage = images.find((image) => image.isDefault) ?? null;
  console.log("[MTA] Returning default image", defaultImage?.id);
  return defaultImage;
}

export async function applyTokenImageById({ actor, tokenDocument, imageId }) {
  if (!actor || !tokenDocument || !imageId) return;

  const data = getActorModuleData(actor);
  const image = data.tokenImages.find((it) => it.id === imageId);
  if (!image) return;

  console.log("[MTA] Applying TOKEN image", { imageId, src: image.src });

  await tokenDocument.update({ "texture.src": image.src });
  await tokenDocument.setFlag(MODULE_ID, TOKEN_FLAG_KEYS.ACTIVE_TOKEN_IMAGE_ID, imageId);

  if (image.dynamicRing?.enabled) {
    await applyDynamicRing({ tokenDocument, ringConfig: image.dynamicRing });
  } else {
    await restoreDynamicRing(tokenDocument);
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
