import { CANVAS_SIZE, DOCUMENT_VERSION, type Background, type CompositionDocument, type MediaObject, type TextObject, type Transform } from "./types.js";
import { MEME_FONT } from "./fonts.js";

let _seq = 0;
export function newObjectId(prefix = "obj"): string {
  _seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${_seq}`;
}

export function createEmptyDocument(background: Background = "transparent"): CompositionDocument {
  return {
    version: DOCUMENT_VERSION,
    canvas: { width: CANVAS_SIZE, height: CANVAS_SIZE, background },
    objects: [],
  };
}

/** Fit source into 1024² centered (contain). Natural size used for default crop. */
export function createFromSource(
  assetId: string,
  naturalWidth: number,
  naturalHeight: number,
  background: Background = "transparent",
): CompositionDocument {
  const scale = Math.min(CANVAS_SIZE / naturalWidth, CANVAS_SIZE / naturalHeight);
  const media: MediaObject = {
    id: newObjectId("media"),
    type: "media",
    asset_id: assetId,
    transform: {
      x: CANVAS_SIZE / 2,
      y: CANVAS_SIZE / 2,
      scale_x: scale,
      scale_y: scale,
      rotation: 0,
    },
    crop: { x: 0, y: 0, width: naturalWidth, height: naturalHeight },
    mask_asset_id: null,
    timing: null,
  };
  return {
    version: DOCUMENT_VERSION,
    canvas: { width: CANVAS_SIZE, height: CANVAS_SIZE, background },
    objects: [media],
  };
}

function mapObject(
  doc: CompositionDocument,
  id: string,
  fn: (o: CompositionDocument["objects"][number]) => CompositionDocument["objects"][number],
): CompositionDocument {
  let found = false;
  const objects = doc.objects.map((o) => {
    if (o.id !== id) return o;
    found = true;
    return fn(o);
  });
  if (!found) throw new Error(`object not found: ${id}`);
  return { ...doc, objects };
}

export function updateTransform(doc: CompositionDocument, id: string, patch: Partial<Transform>): CompositionDocument {
  return mapObject(doc, id, (o) => ({ ...o, transform: { ...o.transform, ...patch } }));
}

export function updateCrop(
  doc: CompositionDocument,
  id: string,
  crop: MediaObject["crop"],
): CompositionDocument {
  return mapObject(doc, id, (o) => {
    if (o.type !== "media") throw new Error("crop only on media objects");
    return { ...o, crop };
  });
}

export function setBackground(doc: CompositionDocument, background: Background): CompositionDocument {
  return { ...doc, canvas: { ...doc.canvas, background } };
}

export function applyMask(doc: CompositionDocument, id: string, maskAssetId: string | null): CompositionDocument {
  return mapObject(doc, id, (o) => {
    if (o.type !== "media") throw new Error("mask only on media objects");
    return { ...o, mask_asset_id: maskAssetId };
  });
}

export function addText(
  doc: CompositionDocument,
  partial?: Partial<Omit<TextObject, "type" | "id">> & { id?: string },
): CompositionDocument {
  const obj: TextObject = {
    id: partial?.id ?? newObjectId("text"),
    type: "text",
    text: partial?.text ?? "TOP TEXT",
    font: partial?.font ?? MEME_FONT,
    font_size: partial?.font_size ?? 96,
    transform: partial?.transform ?? {
      x: CANVAS_SIZE / 2,
      y: 140,
      scale_x: 1,
      scale_y: 1,
      rotation: 0,
    },
    style: partial?.style ?? {
      fill: "#ffffff",
      stroke: "#000000",
      stroke_width: 10,
    },
  };
  return { ...doc, objects: [...doc.objects, obj] };
}

export function updateText(
  doc: CompositionDocument,
  id: string,
  patch: Partial<Pick<TextObject, "text" | "font" | "font_size">> & {
    style?: Partial<TextObject["style"]>;
  },
): CompositionDocument {
  return mapObject(doc, id, (o) => {
    if (o.type !== "text") throw new Error("updateText only on text objects");
    return {
      ...o,
      text: patch.text ?? o.text,
      font: patch.font ?? o.font,
      font_size: patch.font_size ?? o.font_size,
      style: patch.style ? { ...o.style, ...patch.style } : o.style,
    };
  });
}

export function removeObject(doc: CompositionDocument, id: string): CompositionDocument {
  return { ...doc, objects: doc.objects.filter((o) => o.id !== id) };
}

export function findObject(doc: CompositionDocument, id: string) {
  return doc.objects.find((o) => o.id === id);
}
