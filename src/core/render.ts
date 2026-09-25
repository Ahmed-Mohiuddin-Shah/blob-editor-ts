import {
  CANVAS_SIZE,
  type AssetResolver,
  type CompositionDocument,
  type CompositionObject,
  type MediaObject,
  type TextObject,
} from "./types.js";
import { EXPORT_SIZES, type ExportSizeName } from "./sizes.js";
import { MEME_FONT_STACK } from "./fonts.js";
import { mapCompToSource } from "./timing.js";

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
  const ctx = c.getContext("2d", { willReadFrequently: true });
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
  if ("videoWidth" in img && (img as HTMLVideoElement).videoWidth) {
    return { w: (img as HTMLVideoElement).videoWidth, h: (img as HTMLVideoElement).videoHeight };
  }
  return { w: (img as ImageBitmap).width, h: (img as ImageBitmap).height };
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

async function rasterizeMediaLayer(
  obj: MediaObject,
  img: CanvasImageSource,
  mask: CanvasImageSource | null,
): Promise<HTMLCanvasElement | OffscreenCanvas> {
  const crop = obj.crop;
  const nat = naturalSize(img);
  const sw = crop?.width ?? nat.w;
  const sh = crop?.height ?? nat.h;
  const sx = crop?.x ?? 0;
  const sy = crop?.y ?? 0;

  const layer = makeCanvas(Math.max(1, Math.round(sw)), Math.max(1, Math.round(sh)));
  const lctx = get2d(layer);
  lctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  if (mask) {
    lctx.globalCompositeOperation = "destination-in";
    lctx.drawImage(mask, 0, 0, sw, sh);
    lctx.globalCompositeOperation = "source-over";
  }

  // ponytail: crude outline = dilated alpha fill under the layer
  if (obj.outline && obj.outline.width > 0) {
    const outlined = makeCanvas(layer.width, layer.height);
    const octx = get2d(outlined);
    octx.fillStyle = obj.outline.color;
    const w = obj.outline.width;
    for (let dy = -w; dy <= w; dy++) {
      for (let dx = -w; dx <= w; dx++) {
        if (dx * dx + dy * dy > w * w) continue;
        octx.drawImage(layer as CanvasImageSource, dx, dy);
      }
    }
    octx.globalCompositeOperation = "source-in";
    octx.fillStyle = obj.outline.color;
    octx.fillRect(0, 0, outlined.width, outlined.height);
    octx.globalCompositeOperation = "source-over";
    octx.drawImage(layer as CanvasImageSource, 0, 0);
    return outlined;
  }

  return layer;
}

async function drawMedia(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  obj: MediaObject,
  resolver: AssetResolver,
  tMs: number,
) {
  if (obj.keep) {
    if (mapCompToSource(obj.keep, tMs) == null) return;
  }

  const img = await resolveImage(resolver, obj.asset_id);
  if (!img) return;

  if ("currentTime" in img && obj.kind === "video") {
    const srcT = obj.keep ? mapCompToSource(obj.keep, tMs) : tMs;
    if (srcT != null) {
      const v = img as HTMLVideoElement;
      const sec = srcT / 1000;
      if (Math.abs(v.currentTime - sec) > 0.04) {
        v.currentTime = sec;
        await new Promise<void>((res) => {
          const done = () => {
            v.removeEventListener("seeked", done);
            res();
          };
          v.addEventListener("seeked", done);
          setTimeout(done, 80);
        });
      }
    }
  }

  let mask: CanvasImageSource | null = null;
  if (obj.mask_asset_id) {
    mask = await resolveImage(resolver, obj.mask_asset_id);
  }

  const crop = obj.crop;
  const nat = naturalSize(img);
  const sw = crop?.width ?? nat.w;
  const sh = crop?.height ?? nat.h;

  const layer = await rasterizeMediaLayer(obj, img, mask);

  ctx.save();
  ctx.translate(obj.transform.x, obj.transform.y);
  ctx.rotate((obj.transform.rotation * Math.PI) / 180);
  ctx.scale(obj.transform.scale_x, obj.transform.scale_y);
  ctx.drawImage(layer as CanvasImageSource, -sw / 2, -sh / 2);
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
  tMs: number,
) {
  if (obj.type === "media") {
    await drawMedia(ctx, obj, resolver, tMs);
    return;
  }
  drawText(ctx, obj);
}

/** Render one frame at composition time tMs (shared draw contract). */
export async function renderFrame(
  doc: CompositionDocument,
  tMs: number,
  resolver: AssetResolver,
): Promise<HTMLCanvasElement | OffscreenCanvas> {
  const t = Math.max(0, Math.min(tMs, doc.duration_ms || 0));
  const canvas = makeCanvas(CANVAS_SIZE, CANVAS_SIZE);
  const ctx = get2d(canvas);
  drawBackground(ctx, doc.canvas.background);
  for (const obj of doc.objects) {
    await drawObject(ctx, obj, resolver, doc.duration_ms > 0 ? t : 0);
  }
  return canvas;
}

/** Render document at full 1024×1024 (poster / t=0). */
export async function renderFull(
  doc: CompositionDocument,
  resolver: AssetResolver,
): Promise<HTMLCanvasElement | OffscreenCanvas> {
  return renderFrame(doc, 0, resolver);
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

/** Preview ≡ export stills: one full render at t=0, then scale. */
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

/** Bake primary media alpha into a mask PNG when cutout/outline present. */
export async function renderMaskBlob(
  doc: CompositionDocument,
  resolver: AssetResolver,
): Promise<Blob | null> {
  const media = doc.objects.find((o): o is MediaObject => o.type === "media");
  if (!media || (!media.mask_asset_id && !media.outline)) return null;
  const img = await resolveImage(resolver, media.asset_id);
  if (!img) return null;
  let mask: CanvasImageSource | null = null;
  if (media.mask_asset_id) mask = await resolveImage(resolver, media.mask_asset_id);
  const layer = await rasterizeMediaLayer(media, img, mask);
  const m = makeCanvas(layer.width, layer.height);
  const ctx = get2d(m);
  ctx.drawImage(layer as CanvasImageSource, 0, 0);
  const id = ctx.getImageData(0, 0, m.width, m.height);
  const px = id.data;
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    px[i] = px[i + 1] = px[i + 2] = a;
  }
  ctx.putImageData(id, 0, 0);
  return canvasToPngBlob(m);
}
