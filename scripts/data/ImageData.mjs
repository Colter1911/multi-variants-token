/**
 * Data model for a single image entry in token/portrait libraries.
 */
export class ImageData extends foundry.abstract.DataModel {
  static defineSchema() {
    const fields = foundry.data.fields;

    return {
      id: new fields.StringField({ required: true, blank: false }),
      src: new fields.StringField({ required: true, blank: false }),
      sort: new fields.NumberField({ required: true, integer: true, initial: 0 }),
      isDefault: new fields.BooleanField({ required: true, initial: false }),
      autoEnable: new fields.SchemaField({
        enabled: new fields.BooleanField({ required: true, initial: false }),
        wounded: new fields.BooleanField({ required: true, initial: false }),
        woundedPercent: new fields.NumberField({ required: true, integer: true, min: 1, max: 99, initial: 50 }),
        die: new fields.BooleanField({ required: true, initial: false })
      }),
      customScript: new fields.StringField({ required: true, blank: true, initial: "" }),
      dynamicRing: new fields.SchemaField({
        enabled: new fields.BooleanField({ required: true, initial: false }),
        scaleCorrection: new fields.NumberField({ required: true, initial: 1 }),
        ringColor: new fields.ColorField({ required: true, initial: "#ffffff" }),
        backgroundColor: new fields.ColorField({ required: true, initial: "#000000" })
      })
    };
  }
}
