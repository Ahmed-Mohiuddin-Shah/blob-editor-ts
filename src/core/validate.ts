import {
  CANVAS_SIZE,
  DOCUMENT_VERSION,
  type Background,
  type CompositionDocument,
  type CompositionObject,
  type CropRect,
  type MediaObject,
  type TextObject,
  type Timing,
  type Transform,
} from "./types.js";

export class DocumentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentValidationError";
  }
}

function isHexColor(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
}

function isBackground(v: unknown): v is Background {
  return v === "transparent" || isHexColor(v);
}

function isTransform(v: unknown): v is Transform {
  if (!v || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.x === "number" &&
    typeof t.y === "number" &&
    typeof t.scale_x === "number" &&
    typeof t.scale_y === "number" &&
    typeof t.rotation === "number"
  );
}

function isCrop(v: unknown): v is CropRect {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.x === "number" &&
    typeof c.y === "number" &&
    typeof c.width === "number" &&
    typeof c.height === "number" &&
    c.width > 0 &&
    c.height > 0
  );
}

function isTiming(v: unknown): v is Timing {
  if (!v || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  return typeof t.start === "number" && typeof t.end === "number";
}

function validateMedia(o: Record<string, unknown>, index: number): MediaObject {
  if (typeof o.id !== "string" || !o.id) {
    throw new DocumentValidationError(`objects[${index}].id required`);
  }
  if (typeof o.asset_id !== "string" || !o.asset_id) {
    throw new DocumentValidationError(`objects[${index}].asset_id required`);
  }
  if (!isTransform(o.transform)) {
    throw new DocumentValidationError(`objects[${index}].transform invalid`);
  }
  if (o.crop != null && !isCrop(o.crop)) {
    throw new DocumentValidationError(`objects[${index}].crop invalid`);
  }
  if (o.mask_asset_id != null && typeof o.mask_asset_id !== "string") {
    throw new DocumentValidationError(`objects[${index}].mask_asset_id invalid`);
  }
  if (o.timing != null && !isTiming(o.timing)) {
    throw new DocumentValidationError(`objects[${index}].timing invalid`);
  }
  return {
    id: o.id,
    type: "media",
    asset_id: o.asset_id,
    transform: o.transform,
    crop: (o.crop as CropRect | null) ?? null,
    mask_asset_id: (o.mask_asset_id as string | null) ?? null,
    timing: (o.timing as Timing | null) ?? null,
  };
}

function validateText(o: Record<string, unknown>, index: number): TextObject {
  if (typeof o.id !== "string" || !o.id) {
    throw new DocumentValidationError(`objects[${index}].id required`);
  }
  if (typeof o.text !== "string") {
    throw new DocumentValidationError(`objects[${index}].text required`);
  }
  if (typeof o.font !== "string") {
    throw new DocumentValidationError(`objects[${index}].font required`);
  }
  if (typeof o.font_size !== "number") {
    throw new DocumentValidationError(`objects[${index}].font_size required`);
  }
  if (!isTransform(o.transform)) {
    throw new DocumentValidationError(`objects[${index}].transform invalid`);
  }
  const style = o.style as Record<string, unknown> | undefined;
  if (!style || typeof style.fill !== "string" || typeof style.stroke !== "string" || typeof style.stroke_width !== "number") {
    throw new DocumentValidationError(`objects[${index}].style invalid`);
  }
  return {
    id: o.id,
    type: "text",
    text: o.text,
    font: o.font,
    font_size: o.font_size,
    transform: o.transform,
    style: {
      fill: style.fill,
      stroke: style.stroke,
      stroke_width: style.stroke_width,
    },
  };
}

function validateObject(raw: unknown, index: number): CompositionObject {
  if (!raw || typeof raw !== "object") {
    throw new DocumentValidationError(`objects[${index}] must be object`);
  }
  const o = raw as Record<string, unknown>;
  if (o.type === "media") return validateMedia(o, index);
  if (o.type === "text") return validateText(o, index);
  throw new DocumentValidationError(`objects[${index}].type must be media|text`);
}

/** Parse + validate unknown JSON into a CompositionDocument. */
export function validateDocument(raw: unknown): CompositionDocument {
  if (!raw || typeof raw !== "object") {
    throw new DocumentValidationError("document must be an object");
  }
  const d = raw as Record<string, unknown>;
  if (d.version !== DOCUMENT_VERSION) {
    throw new DocumentValidationError(`unsupported version (expected ${DOCUMENT_VERSION})`);
  }
  const canvas = d.canvas as Record<string, unknown> | undefined;
  if (!canvas || canvas.width !== CANVAS_SIZE || canvas.height !== CANVAS_SIZE) {
    throw new DocumentValidationError(`canvas must be ${CANVAS_SIZE}×${CANVAS_SIZE}`);
  }
  if (!isBackground(canvas.background)) {
    throw new DocumentValidationError('canvas.background must be "transparent" or #RRGGBB');
  }
  if (!Array.isArray(d.objects)) {
    throw new DocumentValidationError("objects must be an array");
  }
  const objects = d.objects.map((o, i) => validateObject(o, i));
  const ids = new Set(objects.map((o) => o.id));
  if (ids.size !== objects.length) {
    throw new DocumentValidationError("object ids must be unique");
  }
  return {
    version: DOCUMENT_VERSION,
    canvas: {
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
      background: canvas.background,
    },
    objects,
  };
}
