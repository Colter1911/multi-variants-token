import { ImageData } from "./ImageData.mjs";

/**
 * Root actor flag model for multi-tokenart.
 */
export class ModuleData extends foundry.abstract.DataModel {
  static defineSchema() {
    const fields = foundry.data.fields;

    return {
      version: new fields.NumberField({ required: true, integer: true, initial: 1 }),
      global: new fields.SchemaField({
        autoRotate: new fields.BooleanField({ required: true, initial: true }),
        tokenRandom: new fields.BooleanField({ required: true, initial: false }),
        portraitRandom: new fields.BooleanField({ required: true, initial: false })
      }),
      tokenImages: new fields.ArrayField(new fields.EmbeddedDataField(ImageData)),
      portraitImages: new fields.ArrayField(new fields.EmbeddedDataField(ImageData))
    };
  }
}
