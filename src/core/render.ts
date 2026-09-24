import { CANVAS_SIZE, type AssetResolver, type CompositionDocument, type CompositionObject, type MediaObject, type TextObject } from "./types.js";
import { EXPORT_SIZES, type ExportSizeName } from "./sizes.js";
import { MEME_FONT_STACK } from "./fonts.js";

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(w, h);
  }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function get2d(c: HTMLCanvasElement | OffscreenCanvas): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
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

async function resolveImage(resolver: AssetResolver, assetId: string): Promise<CanvasImageSource | null> {
  return resolver(assetId);
}

function drawBackground(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  background: CompositionDocument["canvas"]["background"],
) {
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  if (background === "transparent") return;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
}

async function drawMedia(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  obj: MediaObject,
  resolver: AssetResolver,
) {
  const img = await resolveImage(resolver, obj.asset_id);
  if (!img) return;

  let mask: CanvasImageSource | null = null;
  if (obj.mask_asset_id) {
    mask = await resolveImage(resolver, obj.mask_asset_id);
  }

  const crop = obj.crop;
  const sw = crop?.width ?? (img as HTMLImageElement).naturalWidth ?? (img as ImageBitmap).width;
  const sh = crop?.height ?? (img as HTMLImageElement).naturalHeight ?? (img as ImageBitmap).height;
  const sx = crop?.x ?? 0;
  const sy = crop?.y ?? 0;

  ctx.save();
  ctx.translate(obj.transform.x, obj.transform.y);
  ctx.rotate((obj.transform.rotation * Math.PI) / 180);
  ctx.scale(obj.transform.scale_x, obj.transform.scale_y);

  if (mask) {
    // Draw masked media into an offscreen layer then composite.
    const layer = makeCanvas(sw, sh);
    const lctx = get2d(layer);
    lctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    lctx.globalCompositeOperation = "destination-in";
    lctx.drawImage(mask, 0, 0, sw, sh);
    ctx.drawImage(layer as CanvasImageSource, -sw / 2, -sh / 2);
  } else {
    ctx.drawImage(img, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
  }
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, obj: TextObject) {
  ctx.save();
  ctx.translate(obj.transform.x, obj.transform.y);
  ctx.rotate((obj.transform.rotation * Math.PI) / 180);
  ctx.scale(obj.transform.scale_x, obj.transform.scale_y);
  ctx.font = `${obj.font_size}px ${
    obj.font === "Impact" || obj.font === "Anton" ? MEME_FONT_STACK : obj.font
  }`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (obj.style.stroke_width > 0) {
    ctx.lineWidth = obj.style.stroke_width;
    ctx.strokeStyle = obj.style.stroke;
    ctx.lineJoin = "round";
    ctx.strokeText(obj.text, 0, 0);
  }
  ctx.fillStyle = obj.style.fill;
  ctx.fillText(obj.text, 0, 0);
  ctx.restore();
}

async function drawObject(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  obj: CompositionObject,
  resolver: AssetResolver,
) {
  if (obj.type === "media") await drawMedia(ctx, obj, resolver);
  else drawText(ctx, obj);
}

/** Render document at full 1024×1024 (shared draw contract). */
export async function renderFull(
  doc: CompositionDocument,
  resolver: AssetResolver,
): Promise<HTMLCanvasElement | OffscreenCanvas> {
  const canvas = makeCanvas(CANVAS_SIZE, CANVAS_SIZE);
  const ctx = get2d(canvas);
  drawBackground(ctx, doc.canvas.background);
  for (const obj of doc.objects) {
    await drawObject(ctx, obj, resolver);
  }
  return canvas;
}

async function scalePng(source: HTMLCanvasElement | OffscreenCanvas, size: number): Promise<Blob> {
  if (size === CANVAS_SIZE) return canvasToPngBlob(source);
  const out = makeCanvas(size, size);
  const ctx = get2d(out);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source as CanvasImageSource, 0, 0, size, size);
  return canvasToPngBlob(out);
}

/** Preview ≡ export: one full render, then scale to chat / thumbnail / full. */
export async function renderExports(
  doc: CompositionDocument,
  resolver: AssetResolver,
): Promise<{ chat: Blob; thumbnail: Blob; full: Blob }> {
  const full = await renderFull(doc, resolver);
  const [chat, thumbnail, fullBlob] = await Promise.all([
    scalePng(full, EXPORT_SIZES.chat),
    scalePng(full, EXPORT_SIZES.thumbnail),
    scalePng(full, EXPORT_SIZES.full),
  ]);
  return { chat, thumbnail, full: fullBlob };
}

export async function renderSize(
  doc: CompositionDocument,
  resolver: AssetResolver,
  size: ExportSizeName,
): Promise<Blob> {
  const full = await renderFull(doc, resolver);
  return scalePng(full, EXPORT_SIZES[size]);
}
