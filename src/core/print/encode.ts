/**
 * Node-oriented print encode (BLOB worker).
 * Do not import from browser bundles — use `blob-editor/encode`.
 *
 * Optional dep: `pdf-lib` (required when formats includes pdf).
 * PNG path needs a canvas environment (Node 20+ OffscreenCanvas, or jsdom + canvas).
 */

import { createRequire } from "node:module";
import {
  DEFAULT_PRINT_DPI,
  type PrintAssetBytesResolver,
  type PrintAssetResolver,
  type PrintDocument,
  type PrintEncodeOptions,
  type PrintEncodePayload,
  type PrintItem,
} from "./types.js";
import { mmToPt } from "./presets.js";
import { renderPrintPage } from "./render.js";

const require = createRequire(import.meta.url);

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

function loadImageFromDataUrl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = src;
  });
}

/** Build a canvas resolver from PNG bytes (Node / worker). */
export async function bytesToPrintResolver(
  bytesResolver: PrintAssetBytesResolver,
  assetIds: string[],
): Promise<PrintAssetResolver> {
  const cache = new Map<string, CanvasImageSource | null>();
  await Promise.all(
    assetIds.map(async (id) => {
      const bytes = await bytesResolver(id);
      if (!bytes) {
        cache.set(id, null);
        return;
      }
      try {
        const blob = new Blob([Uint8Array.from(bytes)], { type: "image/png" });
        if (typeof createImageBitmap === "function") {
          cache.set(id, await createImageBitmap(blob));
          return;
        }
        const b64 = Buffer.from(bytes).toString("base64");
        cache.set(id, await loadImageFromDataUrl(`data:image/png;base64,${b64}`));
      } catch {
        cache.set(id, null);
      }
    }),
  );
  return (id) => cache.get(id) ?? null;
}

function itemSizeMm(item: PrintItem, aspect: number): { w: number; h: number } {
  return { w: item.width_mm, h: item.width_mm * aspect };
}

async function encodePdf(
  doc: PrintDocument,
  bytesResolver: PrintAssetBytesResolver,
): Promise<Uint8Array> {
  let PDFLib: typeof import("pdf-lib");
  try {
    PDFLib = require("pdf-lib");
  } catch {
    throw new Error("encodePrint PDF requires optional dependency `pdf-lib`");
  }
  const { PDFDocument, rgb, degrees } = PDFLib;
  const pdf = await PDFDocument.create();
  const pageW = mmToPt(doc.page.width_mm);
  const pageH = mmToPt(doc.page.height_mm);
  const page = pdf.addPage([pageW, pageH]);

  if (doc.page.background !== "transparent") {
    const hex = doc.page.background.slice(1);
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    page.drawRectangle({
      x: 0,
      y: 0,
      width: pageW,
      height: pageH,
      color: rgb(r, g, b),
    });
  }

  type Embedded = Awaited<ReturnType<typeof pdf.embedPng>>;
  const embedCache = new Map<string, Embedded>();

  for (const item of doc.items) {
    let embedded = embedCache.get(item.asset_id);
    if (!embedded) {
      const bytes = await bytesResolver(item.asset_id);
      if (!bytes) continue;
      embedded = await pdf.embedPng(bytes);
      embedCache.set(item.asset_id, embedded);
    }
    const aspect = embedded.height / Math.max(1, embedded.width);
    const { w, h } = itemSizeMm(item, aspect);
    const wPt = mmToPt(w);
    const hPt = mmToPt(h);
    // PDF origin bottom-left; our doc origin top-left.
    const xPt = mmToPt(item.x_mm);
    const yPt = pageH - mmToPt(item.y_mm) - hPt;
    const cx = xPt + wPt / 2;
    const cy = yPt + hPt / 2;
    page.drawImage(embedded, {
      x: cx - wPt / 2,
      y: cy - hPt / 2,
      width: wPt,
      height: hPt,
      rotate: degrees(-item.rotation_deg),
    });
  }

  if (doc.page.cut_marks) {
    const m = doc.page.margin_mm;
    const mark = mmToPt(3);
    const left = mmToPt(m.left);
    const topFromBottom = pageH - mmToPt(m.top);
    const right = mmToPt(doc.page.width_mm - m.right);
    const bottom = mmToPt(m.bottom);
    const corners: [number, number][] = [
      [left, topFromBottom],
      [right, topFromBottom],
      [left, bottom],
      [right, bottom],
    ];
    for (const [x, y] of corners) {
      page.drawLine({
        start: { x: x - mark, y },
        end: { x: x + mark, y },
        thickness: 0.5,
        color: rgb(0, 0, 0),
      });
      page.drawLine({
        start: { x, y: y - mark },
        end: { x, y: y + mark },
        thickness: 0.5,
        color: rgb(0, 0, 0),
      });
    }
  }

  const saved = await pdf.save();
  return saved instanceof Uint8Array ? saved : new Uint8Array(saved);
}

/**
 * Encode print sheet: PNG (raster at dpi) and/or PDF (embedded source PNGs).
 */
export async function encodePrint(
  doc: PrintDocument,
  bytesResolver: PrintAssetBytesResolver,
  opts: PrintEncodeOptions = {},
): Promise<PrintEncodePayload> {
  const dpi = opts.dpi ?? DEFAULT_PRINT_DPI;
  const formats = opts.formats ?? (["png", "pdf"] as ("png" | "pdf")[]);
  const wantPng = formats.includes("png");
  const wantPdf = formats.includes("pdf");

  const assetIds = [...new Set(doc.items.map((it) => it.asset_id))];
  const exports: PrintEncodePayload["exports"] = {};
  const mimeTypes: PrintEncodePayload["meta"]["mimeTypes"] = {};

  if (wantPng) {
    const resolver = await bytesToPrintResolver(bytesResolver, assetIds);
    const canvas = await renderPrintPage(doc, resolver, dpi);
    exports.png = await canvasToPngBytes(canvas);
    mimeTypes.png = "image/png";
  }

  if (wantPdf) {
    exports.pdf = await encodePdf(doc, bytesResolver);
    mimeTypes.pdf = "application/pdf";
  }

  return {
    document: doc,
    exports,
    meta: {
      width_mm: doc.page.width_mm,
      height_mm: doc.page.height_mm,
      dpi,
      mimeTypes,
    },
  };
}
