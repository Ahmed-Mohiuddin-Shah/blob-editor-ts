/** BLOB Print layout document — page SoT in millimetres (never composition JSON). */

export const PRINT_DOCUMENT_VERSION = 1 as const;

/** Default raster DPI for preview / PNG encode. */
export const DEFAULT_PRINT_DPI = 150 as const;

export type PrintBackground = "transparent" | `#${string}`;

export interface PrintMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PrintPage {
  width_mm: number;
  height_mm: number;
  margin_mm: PrintMargins;
  background: PrintBackground;
  cut_marks: boolean;
}

export interface PrintItem {
  id: string;
  asset_id: string;
  x_mm: number;
  y_mm: number;
  /** Drawn width; height follows source aspect (square stickers → equal). */
  width_mm: number;
  rotation_deg: number;
}

export interface PrintDocument {
  version: typeof PRINT_DOCUMENT_VERSION;
  page: PrintPage;
  items: PrintItem[];
}

export interface PrintExportPayload {
  document: PrintDocument;
  previewPng: Blob;
}

export interface PrintEncodeOptions {
  /** Raster DPI for PNG sheet (default 150). */
  dpi?: number;
  /** Which outputs to produce (default both). */
  formats?: Array<"png" | "pdf">;
}

export interface PrintEncodePayload {
  document: PrintDocument;
  exports: {
    png?: Uint8Array;
    pdf?: Uint8Array;
  };
  meta: {
    width_mm: number;
    height_mm: number;
    dpi: number;
    mimeTypes: {
      png?: string;
      pdf?: string;
    };
  };
}

/** Host-supplied sticker PNG keyed by asset_id (browser / canvas). */
export type PrintAssetResolver = (
  assetId: string,
) => CanvasImageSource | null | Promise<CanvasImageSource | null>;

/** Byte resolver for Node encode. */
export type PrintAssetBytesResolver = (
  assetId: string,
) => Uint8Array | null | Promise<Uint8Array | null>;

export interface PrintAssetMeta {
  id: string;
  label?: string;
  thumbUrl?: string;
}

export interface LayoutGridOptions {
  rows: number;
  columns: number;
  gap_mm?: number;
}
