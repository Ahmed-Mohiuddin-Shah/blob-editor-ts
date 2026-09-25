/**
 * Combine single-page (or multi-page) PDFs / PNG sheets for pack downloads.
 * Node worker only — via `blob-editor/encode`.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Closest-to-square grid that fits `n` cells. */
export function evenGridDims(n: number): { rows: number; columns: number } {
  if (n <= 0) return { rows: 0, columns: 0 };
  const columns = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / columns);
  return { rows, columns };
}

/**
 * Merge PDF byte arrays into one document (pages appended in order).
 * Each input may be one or more pages (typically one page per print sheet).
 */
export async function combinePdfs(pdfs: Uint8Array[]): Promise<Uint8Array> {
  if (!pdfs.length) throw new Error("combinePdfs: no PDFs");
  let PDFLib: typeof import("pdf-lib");
  try {
    PDFLib = require("pdf-lib");
  } catch {
    throw new Error("combinePdfs requires optional dependency `pdf-lib`");
  }
  const { PDFDocument } = PDFLib;
  const out = await PDFDocument.create();
  for (const bytes of pdfs) {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const indices = src.getPageIndices();
    const copied = await out.copyPages(src, indices);
    for (const page of copied) out.addPage(page);
  }
  const saved = await out.save();
  return saved instanceof Uint8Array ? saved : new Uint8Array(saved);
}

export interface CombinePngsGridOptions {
  /** Gap between cells in pixels (default 8). */
  gapPx?: number;
  /** Outer padding in pixels (default = gapPx). */
  paddingPx?: number;
  /** Sheet background (default #FFFFFF). Use "transparent" for alpha. */
  background?: string;
  /**
   * Force cell side length in px. Default = max(source width, height)
   * across inputs so every sticker fits without upscaling smaller ones unevenly.
   */
  cellPx?: number;
  /** Override auto grid (must fit all images: rows*cols >= n). */
  rows?: number;
  columns?: number;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(w, h);
  }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function get2d(
  c: HTMLCanvasElement | OffscreenCanvas,
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  return ctx as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}

async function canvasToPngBytes(c: HTMLCanvasElement | OffscreenCanvas): Promise<Uint8Array> {
  const blob =
    c instanceof OffscreenCanvas
      ? await c.convertToBlob({ type: "image/png" })
      : await new Promise<Blob>((resolve, reject) => {
          (c as HTMLCanvasElement).toBlob(
            (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
            "image/png",
          );
        });
  return new Uint8Array(await blob.arrayBuffer());
}

async function decodePng(bytes: Uint8Array): Promise<ImageBitmap | HTMLImageElement> {
  const blob = new Blob([Uint8Array.from(bytes)], { type: "image/png" });
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(blob);
  }
  const b64 = Buffer.from(bytes).toString("base64");
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("PNG decode failed"));
    img.src = `data:image/png;base64,${b64}`;
  });
}

function naturalSize(img: ImageBitmap | HTMLImageElement): { w: number; h: number } {
  if ("naturalWidth" in img && img.naturalWidth) {
    return { w: img.naturalWidth, h: img.naturalHeight };
  }
  return { w: (img as ImageBitmap).width, h: (img as ImageBitmap).height };
}

/**
 * Pack PNG sheets into one image on an as-even-as-possible grid
 * (e.g. 5 → 2×3, 4 → 2×2, 7 → 3×3 with empty cells).
 */
export async function combinePngsGrid(
  pngs: Uint8Array[],
  opts: CombinePngsGridOptions = {},
): Promise<Uint8Array> {
  if (!pngs.length) throw new Error("combinePngsGrid: no PNGs");

  const images = await Promise.all(pngs.map(decodePng));
  const sizes = images.map(naturalSize);
  const cell =
    opts.cellPx ??
    Math.max(1, ...sizes.map((s) => Math.max(s.w, s.h)));

  const auto = evenGridDims(pngs.length);
  const columns = opts.columns ?? auto.columns;
  const rows = opts.rows ?? auto.rows;
  if (columns * rows < pngs.length) {
    throw new Error("combinePngsGrid: rows*columns < image count");
  }

  const gap = opts.gapPx ?? 8;
  const pad = opts.paddingPx ?? gap;
  const bg = opts.background ?? "#FFFFFF";

  const width = pad * 2 + columns * cell + gap * Math.max(0, columns - 1);
  const height = pad * 2 + rows * cell + gap * Math.max(0, rows - 1);
  const canvas = makeCanvas(width, height);
  const ctx = get2d(canvas);

  if (bg !== "transparent") {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.clearRect(0, 0, width, height);
  }

  for (let i = 0; i < images.length; i++) {
    const r = Math.floor(i / columns);
    const c = i % columns;
    const x0 = pad + c * (cell + gap);
    const y0 = pad + r * (cell + gap);
    const { w, h } = sizes[i]!;
    const scale = Math.min(cell / w, cell / h);
    const dw = w * scale;
    const dh = h * scale;
    const dx = x0 + (cell - dw) / 2;
    const dy = y0 + (cell - dh) / 2;
    ctx.drawImage(images[i] as CanvasImageSource, dx, dy, dw, dh);
  }

  for (const img of images) {
    if ("close" in img && typeof img.close === "function") img.close();
  }

  return canvasToPngBytes(canvas);
}
