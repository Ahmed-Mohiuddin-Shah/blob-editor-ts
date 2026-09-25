import {
  CANVAS_SIZE,
  DOCUMENT_VERSION,
  MAX_DURATION_MS,
  type AudioTrack,
  type Background,
  type CompositionDocument,
  type CompositionObject,
  type CropRect,
  type MediaKind,
  type MediaObject,
  type OutlineStyle,
  type TextObject,
  type TimeRange,
  type Transform,
} from "./types.js";
import { migrateDocument } from "./migrate.js";
import { coerceKeep, rangeDurationMs } from "./timing.js";

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

function isTimeRange(v: unknown): v is TimeRange {
  if (!v || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.start_ms === "number" &&
    typeof t.end_ms === "number" &&
    t.end_ms > t.start_ms
  );
}

function isOutline(v: unknown): v is OutlineStyle {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return isHexColor(o.color) && typeof o.width === "number" && o.width >= 0;
}

function isKind(v: unknown): v is MediaKind {
  return v === "image" || v === "gif" || v === "video";
}

function validateKeep(keep: unknown, path: string): TimeRange | null {
  if (keep == null) return null;
  const coerced = coerceKeep(keep);
  if (!coerced || !isTimeRange(coerced)) {
    throw new DocumentValidationError(`${path} invalid`);
  }
  if (rangeDurationMs(coerced) <= 0) {
    throw new DocumentValidationError(`${path} empty range`);
  }
  return coerced;
}

function validateMedia(o: Record<string, unknown>, index: number): MediaObject {
  if (typeof o.id !== "string" || !o.id) {
    throw new DocumentValidationError(`objects[${index}].id required`);
  }
  if (typeof o.asset_id !== "string" || !o.asset_id) {
    throw new DocumentValidationError(`objects[${index}].asset_id required`);
  }
  if (!isKind(o.kind)) {
    throw new DocumentValidationError(`objects[${index}].kind must be image|gif|video`);
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
  if (o.outline != null && !isOutline(o.outline)) {
    throw new DocumentValidationError(`objects[${index}].outline invalid`);
  }
  if (o.kind !== "image") {
    if (o.mask_asset_id != null) {
      throw new DocumentValidationError(`objects[${index}].mask_asset_id only allowed on image`);
    }
    if (o.outline != null) {
      throw new DocumentValidationError(`objects[${index}].outline only allowed on image`);
    }
  }
  return {
    id: o.id,
    type: "media",
    asset_id: o.asset_id,
    kind: o.kind,
    transform: o.transform,
    crop: (o.crop as CropRect | null) ?? null,
    mask_asset_id: (o.mask_asset_id as string | null) ?? null,
    keep: validateKeep(o.keep, `objects[${index}].keep`),
    outline: (o.outline as OutlineStyle | null) ?? null,
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

function validateAudio(raw: unknown): AudioTrack | null {
  if (raw == null) return null;
  if (typeof raw !== "object") throw new DocumentValidationError("audio invalid");
  const a = raw as Record<string, unknown>;
  if (typeof a.mute_source !== "boolean") {
    throw new DocumentValidationError("audio.mute_source required");
  }
  return { mute_source: a.mute_source };
}

/**
 * Parse + validate unknown JSON into a CompositionDocument.
 * Auto-migrates v1 → v2 and strips removed fields.
 */
export function validateDocument(raw: unknown): CompositionDocument {
  if (!raw || typeof raw !== "object") {
    throw new DocumentValidationError("document must be an object");
  }
  const d = raw as Record<string, unknown>;

  const canvasRaw = d.canvas as Record<string, unknown> | undefined;
  if (!canvasRaw || canvasRaw.width !== CANVAS_SIZE || canvasRaw.height !== CANVAS_SIZE) {
    throw new DocumentValidationError(`canvas must be ${CANVAS_SIZE}×${CANVAS_SIZE}`);
  }

  let normalized: CompositionDocument;
  try {
    if (d.version === 1 || d.version === DOCUMENT_VERSION) {
      normalized = migrateDocument(raw);
    } else {
      throw new DocumentValidationError(`unsupported version (expected ${DOCUMENT_VERSION} or 1)`);
    }
  } catch (e) {
    if (e instanceof DocumentValidationError) throw e;
    throw new DocumentValidationError(e instanceof Error ? e.message : String(e));
  }

  const canvas = normalized.canvas;
  if (!isBackground(canvas.background)) {
    throw new DocumentValidationError('canvas.background must be "transparent" or #RRGGBB');
  }
  if (typeof normalized.duration_ms !== "number" || normalized.duration_ms < 0) {
    throw new DocumentValidationError("duration_ms invalid");
  }
  if (normalized.duration_ms > MAX_DURATION_MS) {
    throw new DocumentValidationError(`duration_ms exceeds ${MAX_DURATION_MS}`);
  }
  if (typeof normalized.fps !== "number" || normalized.fps <= 0) {
    throw new DocumentValidationError("fps invalid");
  }

  const objects = normalized.objects.map((o, i) =>
    validateObject(JSON.parse(JSON.stringify(o)), i),
  );
  const ids = new Set(objects.map((o) => o.id));
  if (ids.size !== objects.length) {
    throw new DocumentValidationError("object ids must be unique");
  }

  const mediaObjects = objects.filter((o): o is MediaObject => o.type === "media");
  const videoCount = mediaObjects.filter((m) => m.kind === "video").length;
  if (videoCount > 1) {
    throw new DocumentValidationError("at most one video media object allowed");
  }
  if (videoCount === 1 && mediaObjects.length > 1) {
    throw new DocumentValidationError("video compositions cannot include other media overlays");
  }
  if (videoCount === 1 && canvas.background === "transparent") {
    throw new DocumentValidationError("video canvas.background cannot be transparent");
  }

  const audio = validateAudio(normalized.audio);
  if (audio && videoCount === 0) {
    throw new DocumentValidationError("audio only allowed on video compositions");
  }

  return {
    version: DOCUMENT_VERSION,
    canvas: {
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
      background: canvas.background,
    },
    objects,
    duration_ms: normalized.duration_ms,
    fps: normalized.fps,
    audio,
  };
}
