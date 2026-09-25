/** BLOB Composition document — canonical SoT (never Konva/Fabric JSON). */

export const DOCUMENT_VERSION = 2 as const;
export const CANVAS_SIZE = 1024 as const;
/** Hard cap for gif/video (post-trim) duration. */
export const MAX_DURATION_MS = 10_000 as const;
export const DEFAULT_FPS_GIF = 15 as const;
export const DEFAULT_FPS_VIDEO = 24 as const;

export type HexColor = `#${string}`;
export type Background = "transparent" | HexColor;
export type MediaKind = "image" | "gif" | "video";

export interface Transform {
  x: number;
  y: number;
  scale_x: number;
  scale_y: number;
  /** Degrees, clockwise. */
  rotation: number;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Inclusive-start exclusive-ish window; duration = end_ms - start_ms. */
export interface TimeRange {
  start_ms: number;
  end_ms: number;
}

export interface OutlineStyle {
  color: HexColor;
  width: number;
}

export interface MediaObject {
  id: string;
  type: "media";
  asset_id: string;
  kind: MediaKind;
  transform: Transform;
  crop: CropRect | null;
  /** Cutout alpha — images only. */
  mask_asset_id: string | null;
  /** Source trim (single range). null = full source. */
  keep: TimeRange | null;
  /** Sticker border — images only. */
  outline: OutlineStyle | null;
}

export interface TextStyle {
  fill: HexColor | string;
  stroke: HexColor | string;
  stroke_width: number;
}

export interface TextObject {
  id: string;
  type: "text";
  text: string;
  font: string;
  font_size: number;
  transform: Transform;
  style: TextStyle;
}

export type CompositionObject = MediaObject | TextObject;

export interface CanvasSpec {
  width: typeof CANVAS_SIZE;
  height: typeof CANVAS_SIZE;
  background: Background;
}

/** Video mute flag only. */
export interface AudioTrack {
  mute_source: boolean;
}

export interface CompositionDocument {
  version: typeof DOCUMENT_VERSION;
  canvas: CanvasSpec;
  objects: CompositionObject[];
  /** Composition length after trim (ms). */
  duration_ms: number;
  /** Encode / scrub hint. */
  fps: number;
  audio: AudioTrack | null;
}

export type ExportSizeKey = "chat" | "thumbnail" | "full";

export interface ExportPayload {
  document: CompositionDocument;
  exports: {
    chat: Blob;
    thumbnail: Blob;
    full: Blob;
  };
  mask?: Blob;
  meta?: {
    background: Background;
    width: typeof CANVAS_SIZE;
    height: typeof CANVAS_SIZE;
    mimeType?: string;
    duration_ms?: number;
    has_audio?: boolean;
  };
}

/** Full server encode result (Node `encodeComposition`). */
export interface EncodePayload {
  document: CompositionDocument;
  exports: {
    chat: Uint8Array;
    thumbnail: Uint8Array;
    full: Uint8Array;
    mask?: Uint8Array;
    gif?: Uint8Array;
    video?: Uint8Array;
  };
  meta: {
    background: Background;
    width: typeof CANVAS_SIZE;
    height: typeof CANVAS_SIZE;
    duration_ms: number;
    has_audio: boolean;
    mimeTypes: {
      chat: string;
      thumbnail: string;
      full: string;
      mask?: string;
      gif?: string;
      video?: string;
    };
  };
}

/** Host-supplied or locally picked bitmap keyed by asset_id. */
export type AssetResolver = (
  assetId: string,
) => CanvasImageSource | null | Promise<CanvasImageSource | null>;

/** Byte resolver for Node encode (images, gif/video files). */
export type AssetBytesResolver = (
  assetId: string,
) => Uint8Array | null | Promise<Uint8Array | null>;

/** @deprecated v1 shape — use TimeRange / keep. Kept for migrate. */
export interface Timing {
  start: number;
  end: number;
}
