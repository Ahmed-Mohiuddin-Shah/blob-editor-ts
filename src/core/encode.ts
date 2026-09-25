/**
 * Node-oriented composition encode (BLOB worker).
 * Do not import from browser bundles — use `blob-editor/encode`.
 *
 * Optional deps: `gifenc`, `ffmpeg-static` (falls back to `ffmpeg` on PATH).
 */

import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { EXPORT_SIZES } from "./sizes.js";
import {
  CANVAS_SIZE,
  type AssetBytesResolver,
  type AssetResolver,
  type CompositionDocument,
  type EncodePayload,
  type MediaObject,
} from "./types.js";
import { renderFrame, renderMaskBlob } from "./render.js";

const require = createRequire(import.meta.url);

async function blobToUint8(b: Blob): Promise<Uint8Array> {
  return new Uint8Array(await b.arrayBuffer());
}

async function canvasToPngBytes(c: HTMLCanvasElement | OffscreenCanvas): Promise<Uint8Array> {
  const blob =
    c instanceof OffscreenCanvas
      ? await c.convertToBlob({ type: "image/png" })
      : await new Promise<Blob>((resolve, reject) => {
          (c as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
        });
  return blobToUint8(blob);
}

function scaleCanvas(source: HTMLCanvasElement | OffscreenCanvas, size: number): HTMLCanvasElement | OffscreenCanvas {
  if (size === CANVAS_SIZE) return source;
  const out =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(size, size)
      : Object.assign(document.createElement("canvas"), { width: size, height: size });
  const ctx = out.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source as CanvasImageSource, 0, 0, size, size);
  return out;
}

function needsGif(doc: CompositionDocument): boolean {
  return doc.duration_ms > 0 && doc.objects.some((o) => o.type === "media" && o.kind === "gif");
}

function needsVideo(doc: CompositionDocument): boolean {
  return doc.duration_ms > 0 && doc.objects.some((o) => o.type === "media" && o.kind === "video");
}

async function encodeGifRgba(
  frames: { data: Uint8Array; width: number; height: number }[],
  delayCs: number,
): Promise<Uint8Array> {
  let mod: {
    GIFEncoder: () => {
      writeFrame: (i: Uint8Array, w: number, h: number, o: object) => void;
      finish: () => void;
      bytes: () => Uint8Array;
    };
    quantize: (d: Uint8Array, n: number) => Uint8Array;
    applyPalette: (d: Uint8Array, p: Uint8Array) => Uint8Array;
  };
  try {
    mod = require("gifenc");
  } catch {
    throw new Error("encodeComposition GIF requires optional dependency `gifenc`");
  }
  const gif = mod.GIFEncoder();
  for (const f of frames) {
    const palette = mod.quantize(f.data, 256);
    const index = mod.applyPalette(f.data, palette);
    gif.writeFrame(index, f.width, f.height, { palette, delay: delayCs });
  }
  gif.finish();
  return gif.bytes();
}

function runFfmpeg(args: string[], ffmpegPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { stdio: "ignore" });
    p.on("error", reject);
    p.on("close", (code: number | null) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
  });
}

function resolveFfmpeg(): string {
  try {
    return require("ffmpeg-static") as string;
  } catch {
    return "ffmpeg";
  }
}

/**
 * Encode composition derivatives for the BLOB worker.
 * Uses the same `renderFrame` contract as preview.
 * No soundtrack mux — mute_source is reflected in meta.has_audio only.
 */
export async function encodeComposition(
  doc: CompositionDocument,
  frameResolver: AssetResolver,
  _bytesResolver?: AssetBytesResolver,
): Promise<EncodePayload> {
  const fullCanvas = await renderFrame(doc, 0, frameResolver);
  const [chat, thumbnail, fullBytes] = await Promise.all([
    canvasToPngBytes(scaleCanvas(fullCanvas, EXPORT_SIZES.chat)),
    canvasToPngBytes(scaleCanvas(fullCanvas, EXPORT_SIZES.thumbnail)),
    canvasToPngBytes(fullCanvas),
  ]);

  let mask: Uint8Array | undefined;
  const maskBlob = await renderMaskBlob(doc, frameResolver);
  if (maskBlob) mask = await blobToUint8(maskBlob);

  const exports: EncodePayload["exports"] = { chat, thumbnail, full: fullBytes, mask };
  const mimeTypes: EncodePayload["meta"]["mimeTypes"] = {
    chat: "image/png",
    thumbnail: "image/png",
    full: "image/png",
    mask: mask ? "image/png" : undefined,
  };

  const fps = doc.fps || 15;
  const duration = doc.duration_ms;

  if (duration > 0 && (needsGif(doc) || needsVideo(doc))) {
    const frameCount = Math.max(1, Math.ceil((duration / 1000) * fps));
    const rgbaFrames: { data: Uint8Array; width: number; height: number }[] = [];
    const dir = await mkdtemp(join(tmpdir(), "blob-enc-"));

    try {
      for (let i = 0; i < frameCount; i++) {
        const t = Math.min(duration, (i / fps) * 1000);
        const canvas = await renderFrame(doc, t, frameResolver);
        const ctx = canvas.getContext("2d", { willReadFrequently: true }) as
          | CanvasRenderingContext2D
          | OffscreenCanvasRenderingContext2D
          | null;
        if (!ctx) throw new Error("2d context unavailable");
        const id = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        rgbaFrames.push({ data: new Uint8Array(id.data.buffer.slice(0)), width: CANVAS_SIZE, height: CANVAS_SIZE });
        await writeFile(join(dir, `f${String(i).padStart(5, "0")}.png`), await canvasToPngBytes(canvas));
      }

      if (needsGif(doc)) {
        const delayCs = Math.max(1, Math.round(100 / fps));
        exports.gif = await encodeGifRgba(rgbaFrames, delayCs);
        mimeTypes.gif = "image/gif";
      }

      if (needsVideo(doc)) {
        const outMp4 = join(dir, "out.mp4");
        const ffmpeg = resolveFfmpeg();
        const pattern = join(dir, "f%05d.png");
        // Always -an: original sound removal is the only audio control in this pass
        const args = [
          "-y",
          "-framerate",
          String(fps),
          "-i",
          pattern,
          "-pix_fmt",
          "yuv420p",
          "-t",
          String(duration / 1000),
          "-c:v",
          "libx264",
          "-an",
          outMp4,
        ];
        await runFfmpeg(args, ffmpeg);
        exports.video = new Uint8Array(await readFile(outMp4));
        mimeTypes.video = "video/mp4";
      }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  const muted = doc.audio?.mute_source !== false;
  return {
    document: doc,
    exports,
    meta: {
      background: doc.canvas.background,
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
      duration_ms: doc.duration_ms,
      has_audio: !!(exports.video && !muted),
      mimeTypes,
    },
  };
}

export function compositionNeedsAnimatedEncode(doc: CompositionDocument): boolean {
  return needsGif(doc) || needsVideo(doc);
}

export function primaryMedia(doc: CompositionDocument): MediaObject | undefined {
  return doc.objects.find((o): o is MediaObject => o.type === "media");
}

export type { EncodePayload, AssetBytesResolver };
