import {
  CANVAS_SIZE,
  DEFAULT_FPS_GIF,
  DEFAULT_FPS_VIDEO,
  DOCUMENT_VERSION,
  MAX_DURATION_MS,
  type AudioTrack,
  type CompositionDocument,
  type CompositionObject,
  type MediaKind,
  type MediaObject,
  type TextObject,
  type TimeRange,
} from "./types.js";
import { coerceKeep, keepDurationMs } from "./timing.js";

/** Accept v1 or v2 raw JSON → normalized v2 document (does not full-validate). */
export function migrateDocument(raw: unknown): CompositionDocument {
  if (!raw || typeof raw !== "object") {
    throw new Error("document must be an object");
  }
  const d = raw as Record<string, unknown>;
  const version = d.version;

  if (version === DOCUMENT_VERSION) {
    return normalizeV2(d);
  }

  if (version === 1) {
    return migrateV1(d);
  }

  throw new Error(`unsupported document version: ${String(version)}`);
}

function migrateV1(d: Record<string, unknown>): CompositionDocument {
  const canvas = d.canvas as Record<string, unknown>;
  const objectsRaw = (d.objects as unknown[]) ?? [];
  const objects: CompositionObject[] = objectsRaw.map((raw, i) => {
    const o = raw as Record<string, unknown>;
    if (o.type === "text") return migrateText(o);
    if (o.type === "media") return migrateMedia(o);
    throw new Error(`objects[${i}].type must be media|text`);
  });

  const primary = objects.find((o): o is MediaObject => o.type === "media");
  const kind = primary?.kind ?? "image";
  const duration_ms = Math.min(
    MAX_DURATION_MS,
    primary?.keep ? keepDurationMs(primary.keep) : 0,
  );

  return {
    version: DOCUMENT_VERSION,
    canvas: {
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
      background: (canvas?.background as CompositionDocument["canvas"]["background"]) ?? "transparent",
    },
    objects,
    duration_ms,
    fps: kind === "video" ? DEFAULT_FPS_VIDEO : DEFAULT_FPS_GIF,
    audio: normalizeAudio(d.audio, kind),
  };
}

function timingToKeep(timing: unknown): TimeRange | null {
  if (!timing || typeof timing !== "object") return null;
  const t = timing as Record<string, unknown>;
  if (typeof t.start !== "number" || typeof t.end !== "number") return null;
  let start = t.start;
  let end = t.end;
  if (end <= 120 && start < 120) {
    start *= 1000;
    end *= 1000;
  }
  if (end <= start) return null;
  return { start_ms: start, end_ms: end };
}

function migrateMedia(o: Record<string, unknown>): MediaObject {
  let keep: TimeRange | null = null;
  if (o.keep != null) {
    keep = coerceKeep(o.keep);
    if (!keep) throw new Error("keep invalid");
  } else {
    keep = timingToKeep(o.timing);
  }
  return {
    id: String(o.id),
    type: "media",
    asset_id: String(o.asset_id),
    kind: (o.kind as MediaKind) ?? "image",
    transform: o.transform as MediaObject["transform"],
    crop: (o.crop as MediaObject["crop"]) ?? null,
    mask_asset_id: (o.mask_asset_id as string | null) ?? null,
    keep,
    outline: (o.outline as MediaObject["outline"]) ?? null,
  };
}

function migrateText(o: Record<string, unknown>): TextObject {
  return {
    id: String(o.id),
    type: "text",
    text: String(o.text ?? ""),
    font: String(o.font ?? "Anton"),
    font_size: Number(o.font_size ?? 96),
    transform: o.transform as TextObject["transform"],
    style: o.style as TextObject["style"],
  };
}

function normalizeAudio(raw: unknown, kind: MediaKind): AudioTrack | null {
  if (kind !== "video") return null;
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  return { mute_source: typeof a.mute_source === "boolean" ? a.mute_source : true };
}

function normalizeV2(d: Record<string, unknown>): CompositionDocument {
  const canvas = d.canvas as Record<string, unknown>;
  const objects = ((d.objects as unknown[]) ?? []).map((raw) => {
    const o = raw as Record<string, unknown>;
    if (o.type === "text") return migrateText(o);
    return migrateMedia(o);
  });
  const primary = objects.find((o): o is MediaObject => o.type === "media");
  const kind = primary?.kind ?? "image";
  return {
    version: DOCUMENT_VERSION,
    canvas: {
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
      background: (canvas?.background as CompositionDocument["canvas"]["background"]) ?? "transparent",
    },
    objects,
    duration_ms: typeof d.duration_ms === "number" ? d.duration_ms : 0,
    fps: typeof d.fps === "number" ? d.fps : DEFAULT_FPS_GIF,
    audio: normalizeAudio(d.audio, kind),
  };
}
