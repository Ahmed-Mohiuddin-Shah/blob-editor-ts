import {
  CANVAS_SIZE,
  DEFAULT_FPS_GIF,
  DEFAULT_FPS_VIDEO,
  DOCUMENT_VERSION,
  MAX_DURATION_MS,
  type AudioTrack,
  type Background,
  type CompositionDocument,
  type MediaKind,
  type MediaObject,
  type OutlineStyle,
  type TextObject,
  type TimeRange,
  type Transform,
} from "./types.js";
import { MEME_FONT } from "./fonts.js";
import { keepDurationMs } from "./timing.js";

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
    duration_ms: 0,
    fps: DEFAULT_FPS_GIF,
    audio: null,
  };
}

/** Fit source into 1024² centered (contain). */
export function createFromSource(
  assetId: string,
  naturalWidth: number,
  naturalHeight: number,
  background: Background = "transparent",
  opts?: { kind?: MediaKind; durationMs?: number; fps?: number },
): CompositionDocument {
  const kind = opts?.kind ?? "image";
  const bg: Background =
    kind === "video" && background === "transparent" ? "#000000" : background;
  const scale = Math.min(CANVAS_SIZE / naturalWidth, CANVAS_SIZE / naturalHeight);
  const duration_ms = Math.min(
    MAX_DURATION_MS,
    kind === "image" ? 0 : Math.max(0, opts?.durationMs ?? 0),
  );
  const keep: TimeRange | null =
    kind === "image" || duration_ms <= 0 ? null : { start_ms: 0, end_ms: duration_ms };
  const media: MediaObject = {
    id: newObjectId("media"),
    type: "media",
    asset_id: assetId,
    kind,
    transform: {
      x: CANVAS_SIZE / 2,
      y: CANVAS_SIZE / 2,
      scale_x: scale,
      scale_y: scale,
      rotation: 0,
    },
    crop: { x: 0, y: 0, width: naturalWidth, height: naturalHeight },
    mask_asset_id: null,
    keep,
    outline: null,
  };
  return {
    version: DOCUMENT_VERSION,
    canvas: { width: CANVAS_SIZE, height: CANVAS_SIZE, background: bg },
    objects: [media],
    duration_ms,
    fps: opts?.fps ?? (kind === "video" ? DEFAULT_FPS_VIDEO : DEFAULT_FPS_GIF),
    audio: kind === "video" ? { mute_source: true } : null,
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
  const hasVideo = doc.objects.some((o) => o.type === "media" && o.kind === "video");
  if (hasVideo && background === "transparent") {
    throw new Error("video canvas cannot be transparent");
  }
  return { ...doc, canvas: { ...doc.canvas, background } };
}

export function applyMask(doc: CompositionDocument, id: string, maskAssetId: string | null): CompositionDocument {
  return mapObject(doc, id, (o) => {
    if (o.type !== "media") throw new Error("mask only on media objects");
    if (o.kind !== "image") throw new Error("mask only on image media");
    return { ...o, mask_asset_id: maskAssetId };
  });
}

export function setOutline(doc: CompositionDocument, id: string, outline: OutlineStyle | null): CompositionDocument {
  return mapObject(doc, id, (o) => {
    if (o.type !== "media") throw new Error("outline only on media objects");
    if (o.kind !== "image") throw new Error("outline only on image media");
    return { ...o, outline };
  });
}

/** Set single-range trim on media. */
export function setTrim(
  doc: CompositionDocument,
  id: string,
  startMs: number,
  endMs: number,
): CompositionDocument {
  if (!(endMs > startMs)) throw new Error("trim end_ms must be > start_ms");
  const keep: TimeRange = { start_ms: startMs, end_ms: endMs };
  return mapObject(doc, id, (o) => {
    if (o.type !== "media") throw new Error("trim only on media objects");
    if (o.kind === "image") throw new Error("trim not allowed on image");
    return { ...o, keep };
  });
}

export function clearTrim(doc: CompositionDocument, id: string): CompositionDocument {
  return mapObject(doc, id, (o) => {
    if (o.type !== "media") throw new Error("trim only on media objects");
    return { ...o, keep: null };
  });
}

/** @deprecated use setTrim — accepts single range only */
export function setKeep(doc: CompositionDocument, id: string, keep: TimeRange | null): CompositionDocument {
  return mapObject(doc, id, (o) => {
    if (o.type !== "media") throw new Error("keep only on media objects");
    return { ...o, keep };
  });
}

/** Recompute duration_ms from primary media keep. Caps at MAX_DURATION_MS. */
export function syncDurationFromPrimary(doc: CompositionDocument): CompositionDocument {
  const primary = doc.objects.find((o): o is MediaObject => o.type === "media");
  if (!primary) return { ...doc, duration_ms: 0 };
  if (primary.kind === "image" && !primary.keep) return { ...doc, duration_ms: 0 };
  const ms = primary.keep ? keepDurationMs(primary.keep) : doc.duration_ms;
  return { ...doc, duration_ms: Math.min(MAX_DURATION_MS, ms) };
}

export function setAudio(doc: CompositionDocument, audio: AudioTrack | null): CompositionDocument {
  const hasVideo = doc.objects.some((o) => o.type === "media" && o.kind === "video");
  if (audio && !hasVideo) throw new Error("audio only on video compositions");
  return { ...doc, audio };
}

export function setMuteSource(doc: CompositionDocument, mute: boolean): CompositionDocument {
  return setAudio(doc, { mute_source: mute });
}

export function addMedia(
  doc: CompositionDocument,
  partial: {
    asset_id: string;
    kind: MediaKind;
    naturalWidth: number;
    naturalHeight: number;
    keep?: TimeRange | null;
    id?: string;
  },
): CompositionDocument {
  if (partial.kind === "video") {
    throw new Error("cannot add video as overlay");
  }
  const hasVideo = doc.objects.some((o) => o.type === "media" && o.kind === "video");
  if (hasVideo) {
    throw new Error("cannot add media overlays to a video composition");
  }
  const scale = Math.min(CANVAS_SIZE / partial.naturalWidth, CANVAS_SIZE / partial.naturalHeight) * 0.5;
  const media: MediaObject = {
    id: partial.id ?? newObjectId("media"),
    type: "media",
    asset_id: partial.asset_id,
    kind: partial.kind,
    transform: {
      x: CANVAS_SIZE / 2,
      y: CANVAS_SIZE / 2,
      scale_x: scale,
      scale_y: scale,
      rotation: 0,
    },
    crop: { x: 0, y: 0, width: partial.naturalWidth, height: partial.naturalHeight },
    mask_asset_id: null,
    keep: partial.keep ?? null,
    outline: null,
  };
  return { ...doc, objects: [...doc.objects, media] };
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

export function setDuration(doc: CompositionDocument, durationMs: number): CompositionDocument {
  return { ...doc, duration_ms: Math.min(MAX_DURATION_MS, Math.max(0, durationMs)) };
}

export function setFps(doc: CompositionDocument, fps: number): CompositionDocument {
  return { ...doc, fps: Math.max(1, fps) };
}
