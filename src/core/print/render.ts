import { DEFAULT_PRINT_DPI, type PrintAssetResolver, type PrintDocument, type PrintItem } from "./types.js";
import { mmToPx, pagePixelSize } from "./presets.js";

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

async function canvasToPngBlob(c: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
  if (c instanceof OffscreenCanvas) {
    return c.convertToBlob({ type: "image/png" });
  }
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
  });
}

function naturalSize(img: CanvasImageSource): { w: number; h: number } {
  if ("naturalWidth" in img && (img as HTMLImageElement).naturalWidth) {
    return { w: (img as HTMLImageElement).naturalWidth, h: (img as HTMLImageElement).naturalHeight };
  }
  if ("width" in img && typeof (img as ImageBitmap).width === "number") {
    return { w: (img as ImageBitmap).width, h: (img as ImageBitmap).height };
  }
  return { w: 1, h: 1 };
}

function drawCutMarks(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  doc: PrintDocument,
  dpi: number,
) {
  if (!doc.page.cut_marks) return;
  const m = doc.page.margin_mm;
  const mark = mmToPx(3, dpi);
  const stroke = Math.max(1, mmToPx(0.2, dpi));
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = stroke;
  const left = mmToPx(m.left, dpi);
  const top = mmToPx(m.top, dpi);
  const right = mmToPx(doc.page.width_mm - m.right, dpi);
  const bottom = mmToPx(doc.page.height_mm - m.bottom, dpi);
  const corners: [number, number][] = [
    [left, top],
    [right, top],
    [left, bottom],
    [right, bottom],
  ];
  for (const [x, y] of corners) {
    ctx.beginPath();
    ctx.moveTo(x - mark, y);
    ctx.lineTo(x + mark, y);
    ctx.moveTo(x, y - mark);
    ctx.lineTo(x, y + mark);
    ctx.stroke();
  }
}

async function drawItem(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  item: PrintItem,
  img: CanvasImageSource,
  dpi: number,
) {
  const nat = naturalSize(img);
  const aspect = nat.h / Math.max(1, nat.w);
  const wPx = mmToPx(item.width_mm, dpi);
  const hPx = wPx * aspect;
  const cx = mmToPx(item.x_mm, dpi) + wPx / 2;
  const cy = mmToPx(item.y_mm, dpi) + hPx / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((item.rotation_deg * Math.PI) / 180);
  ctx.drawImage(img, -wPx / 2, -hPx / 2, wPx, hPx);
  ctx.restore();
}

/** Draw print page at dpi. Preview ≡ PNG encode path. */
export async function renderPrintPage(
  doc: PrintDocument,
  resolver: PrintAssetResolver,
  dpi: number = DEFAULT_PRINT_DPI,
): Promise<HTMLCanvasElement | OffscreenCanvas> {
  const { width, height } = pagePixelSize(doc.page, dpi);
  const canvas = makeCanvas(width, height);
  const ctx = get2d(canvas);
  ctx.clearRect(0, 0, width, height);
  if (doc.page.background !== "transparent") {
    ctx.fillStyle = doc.page.background;
    ctx.fillRect(0, 0, width, height);
  }
  for (const item of doc.items) {
    const img = await resolver(item.asset_id);
    if (!img) continue;
    await drawItem(ctx, item, img, dpi);
  }
  drawCutMarks(ctx, doc, dpi);
  return canvas;
}

export async function renderPrintPngBlob(
  doc: PrintDocument,
  resolver: PrintAssetResolver,
  dpi: number = DEFAULT_PRINT_DPI,
): Promise<Blob> {
  const canvas = await renderPrintPage(doc, resolver, dpi);
  return canvasToPngBlob(canvas);
}
