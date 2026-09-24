/** BLOB Composition document — canonical SoT (never Konva/Fabric JSON). */

export const DOCUMENT_VERSION = 1 as const;
export const CANVAS_SIZE = 1024 as const;

export type HexColor = `#${string}`;
export type Background = "transparent" | HexColor;

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

/** Reserved for GIF/video; null for static. */
export interface Timing {
  start: number;
  end: number;
}

export interface MediaObject {
  id: string;
  type: "media";
  asset_id: string;
  transform: Transform;
  crop: CropRect | null;
  mask_asset_id: string | null;
  timing: Timing | null;
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

export interface CompositionDocument {
  version: typeof DOCUMENT_VERSION;
  canvas: CanvasSpec;
  objects: CompositionObject[];
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
  };
}

/** Host-supplied or locally picked bitmap keyed by asset_id. */
export type AssetResolver = (assetId: string) => CanvasImageSource | null | Promise<CanvasImageSource | null>;
