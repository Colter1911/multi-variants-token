import { MODULE_ID } from "../constants.mjs";
import { getActorModuleData } from "../utils/flag-utils.mjs";
import { resolveHpData } from "../utils/hp-resolver.mjs";
import { applyAutoRotate } from "./AutoRotate.mjs";
import { applyDynamicRing, restoreDynamicRing } from "./DynamicRing.mjs";

export async function runAutoActivation({ actor, tokenDocument }) {
  if (!actor || !tokenDocument) return;

  const data = getActorModuleData(actor);
  const hp = resolveHpData(actor);

  if (data.global.autoRotate) {
    await applyAutoRotate({ tokenDocument, shouldRotate: hp.current <= 0 });
  }

  if (!data.global.tokenRandom) {
    const selectedTokenImage = selectImageForHp({ images: data.tokenImages, actor, tokenDocument, hp });
    if (selectedTokenImage) {
      await applyTokenImageById({ actor, tokenDocument, imageId: selectedTokenImage.id });
    }
  }

  if (!data.global.portraitRandom) {
    const selectedPortrait = selectImageForHp({ images: data.portraitImages, actor, tokenDocument, hp });
    if (selectedPortrait) {
      await applyPortraitById({ actor, tokenDocument, imageId: selectedPortrait.id });
    }
  }
}

export function selectImageForHp({ images = [], actor, tokenDocument, hp }) {
  const scripted = [];
  const wounded = [];
  const die = [];

  for (const image of images) {
    if (image.customScript?.trim()) {
      const isMatch = evaluateScript(image.customScript, actor, tokenDocument);
      if (isMatch) scripted.push(image);
    }

    if (image.autoEnable?.wounded && hp.percent <= Number(image.autoEnable.woundedPercent ?? 50)) {
      wounded.push(image);
    } else if (image.autoEnable?.die && hp.current <= 0) {
      die.push(image);
    }
  }

  if (scripted.length) return scripted[0];

  if (wounded.length) {
    wounded.sort((a, b) => Number(a.autoEnable.woundedPercent) - Number(b.autoEnable.woundedPercent));
    return wounded[0];
  }

  if (die.length) return die[0];

  return images.find((image) => image.isDefault) ?? null;
}

function evaluateScript(source, actor, tokenDocument) {
  try {
    const fn = new Function("actor", "token", `return Boolean((() => { ${source} })());`);
    return Boolean(fn(actor, tokenDocument));
  } catch (_error) {
    return false;
  }
}

export async function applyTokenImageById({ actor, tokenDocument, imageId }) {
  if (!actor || !tokenDocument || !imageId) return;

  const data = getActorModuleData(actor);
  const image = data.tokenImages.find((it) => it.id === imageId);
  if (!image) return;

  await tokenDocument.update({ "texture.src": image.src });
  await tokenDocument.setFlag(MODULE_ID, "activeTokenImageId", imageId);

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

  await actor.update({ img: image.src });
  await tokenDocument.setFlag(MODULE_ID, "activePortraitImageId", imageId);
}
