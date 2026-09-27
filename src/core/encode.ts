/**
 * Node-oriented composition encode (BLOB worker).
 * Do not import from browser bundles — use `blob-editor/encode`.
 *
 * Optional deps: `gifenc`, `ffmpeg-static` (falls back to `ffmpeg` on PATH).
 * Animated gif/video require a working `bytesResolver` (original file bytes).
 */

import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, access, constants } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { EXPORT_SIZES } from "./sizes.js";
import {
  CANVAS_SIZE,
  MAX_STILL_BYTES,
  MAX_VIDEO_BYTES,
  resolveMaxDurationMs,
  type AssetBytesResolver,
  type AssetResolver,
  type CompositionDocument,
  type EncodePayload,
  type MediaObject,
} from "./types.js";
import { renderFrame, renderMaskBlob } from "./render.js";
import { decodeGifBytes, gifFrameAt, type GifFrameCanvas } from "./gif.js";
import { encodeGifUnderBudget } from "./gif-encode.js";
import { mapCompToSource } from "./timing.js";

const require = createRequire(import.meta.url);

async function blobToUint8(b: Blob): Promise<Uint8Array> {
  return new Uint8Array(await b.arrayBuffer());
}

async function canvasToPngBytes(c: HTMLCanvasElement | OffscreenCanvas): Promise<Uint8Array> {
  const maybeBuf = c as unknown as { toBuffer?: (m?: string) => Buffer };
  if (typeof maybeBuf.toBuffer === "function") {
    return new Uint8Array(maybeBuf.toBuffer("image/png"));
  }
  const blob =
    typeof OffscreenCanvas !== "undefined" && c instanceof OffscreenCanvas
      ? await c.convertToBlob({ type: "image/png" })
      : await new Promise<Blob>((resolve, reject) => {
          (c as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
        });
  return blobToUint8(blob);
}

async function canvasToBytes(
  c: HTMLCanvasElement | OffscreenCanvas,
  mime: string,
  quality?: number,
): Promise<Uint8Array> {
  const maybeBuf = c as unknown as { toBuffer?: (m?: string, o?: object) => Buffer };
  if (typeof maybeBuf.toBuffer === "function") {
    if (mime === "image/jpeg") return new Uint8Array(maybeBuf.toBuffer("image/jpeg", { quality: quality ?? 0.85 }));
    if (mime === "image/png") return new Uint8Array(maybeBuf.toBuffer("image/png"));
    // node-canvas has limited webp; fall through to toBlob when available
  }
  const blob =
    typeof OffscreenCanvas !== "undefined" && c instanceof OffscreenCanvas
      ? await c.convertToBlob({ type: mime, quality })
      : await new Promise<Blob>((resolve, reject) => {
          (c as HTMLCanvasElement).toBlob(
            (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
            mime,
            quality,
          );
        });
  return blobToUint8(blob);
}

function hasAlpha(c: HTMLCanvasElement | OffscreenCanvas): boolean {
  const ctx = c.getContext("2d", { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) return true;
  const { data } = ctx.getImageData(0, 0, Math.min(64, c.width), Math.min(64, c.height));
  for (let i = 3; i < data.length; i += 4) {
    if (data[i]! < 255) return true;
  }
  return false;
}

/** PNG if under budget; else WebP/JPEG quality ladder. */
async function encodeStillUnderBudget(
  c: HTMLCanvasElement | OffscreenCanvas,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const png = await canvasToPngBytes(c);
  if (png.byteLength <= MAX_STILL_BYTES) return { bytes: png, mime: "image/png" };

  const alpha = hasAlpha(c);
  const qualities = [0.92, 0.8, 0.65, 0.5, 0.35];
  if (alpha) {
    for (const q of qualities) {
      try {
        const webp = await canvasToBytes(c, "image/webp", q);
        if (webp.byteLength <= MAX_STILL_BYTES) return { bytes: webp, mime: "image/webp" };
      } catch {
        /* webp unsupported */
      }
    }
  }
  for (const q of qualities) {
    const jpeg = await canvasToBytes(c, "image/jpeg", q);
    if (jpeg.byteLength <= MAX_STILL_BYTES) return { bytes: jpeg, mime: "image/jpeg" };
  }
  // Scale down and retry JPEG
  for (const edge of [768, 512, 384]) {
    const scaled = scaleCanvas(c, edge);
    for (const q of qualities) {
      const jpeg = await canvasToBytes(scaled, "image/jpeg", q);
      if (jpeg.byteLength <= MAX_STILL_BYTES) return { bytes: jpeg, mime: "image/jpeg" };
    }
  }
  throw new Error(`Still encode exceeds ${MAX_STILL_BYTES} bytes after budget reductions`);
}

function scaleCanvas(source: HTMLCanvasElement | OffscreenCanvas, size: number): HTMLCanvasElement | OffscreenCanvas {
  if (size === source.width && size === source.height) return source;
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

/** Emit composed GIF for gif sources and as silent lightweight preview for video. */
function needsGifExport(doc: CompositionDocument): boolean {
  return needsGif(doc) || needsVideo(doc);
}

function runFfmpeg(args: string[], ffmpegPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { stdio: "ignore" });
    p.on("error", reject);
    p.on("close", (code: number | null) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
  });
}

/** Capture stderr (for duration probe). */
function runFfmpegCapture(args: string[], ffmpegPath: string): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    p.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    p.on("error", reject);
    p.on("close", (code: number | null) => resolve({ code, stderr }));
  });
}

function resolveFfmpeg(): string {
  try {
    return require("ffmpeg-static") as string;
  } catch {
    return "ffmpeg";
  }
}

async function probeDurationSec(videoPath: string, ffmpeg: string): Promise<number | null> {
  const { stderr } = await runFfmpegCapture(["-i", videoPath], ffmpeg);
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

async function loadPngBytes(bytes: Uint8Array): Promise<CanvasImageSource> {
  const blob = new Blob([Uint8Array.from(bytes)], { type: "image/png" });
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(blob);
  }
  const b64 = Buffer.from(bytes).toString("base64");
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("png decode failed"));
    img.src = `data:image/png;base64,${b64}`;
  });
}

type GifSource = {
  kind: "gif";
  frames: GifFrameCanvas[];
  delaysMs: number[];
  keep: MediaObject["keep"];
};

type VideoSource = {
  kind: "video";
  path: string;
  keep: MediaObject["keep"];
  cache: Map<number, CanvasImageSource>;
  durationSec: number | null;
  lastGood: CanvasImageSource | null;
};

type AnimatedSource = GifSource | VideoSource;

async function pngExistsNonEmpty(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    const buf = await readFile(path);
    return buf.byteLength > 0;
  } catch {
    return false;
  }
}

/**
 * Extract one video frame. Verifies PNG exists+nonempty; retries accurate seek,
 * EOF clamp, then last-good / t=0. Never treats exit 0 alone as success.
 */
async function extractVideoFrame(
  src: VideoSource,
  sourceMs: number,
  outPng: string,
  ffmpeg: string,
): Promise<CanvasImageSource> {
  if (src.durationSec == null) {
    src.durationSec = await probeDurationSec(src.path, ffmpeg);
  }

  const attempts: number[] = [sourceMs / 1000];
  if (src.durationSec != null && src.durationSec > 0) {
    const clamped = Math.max(0, src.durationSec - 0.05);
    if (sourceMs / 1000 > clamped) attempts.push(clamped);
  }
  attempts.push(0);

  const seen = new Set<string>();
  for (const seekSec of attempts) {
    const key = seekSec.toFixed(4);
    if (seen.has(key)) continue;
    seen.add(key);

    // 1) Fast input seek
    try {
      await runFfmpeg(
        ["-y", "-ss", String(seekSec), "-i", src.path, "-frames:v", "1", "-q:v", "2", outPng],
        ffmpeg,
      );
      if (await pngExistsNonEmpty(outPng)) {
        const frame = await loadPngBytes(new Uint8Array(await readFile(outPng)));
        src.lastGood = frame;
        return frame;
      }
    } catch {
      /* try accurate */
    }

    // 2) Accurate seek (-ss after -i)
    try {
      await runFfmpeg(
        ["-y", "-i", src.path, "-ss", String(seekSec), "-frames:v", "1", "-q:v", "2", outPng],
        ffmpeg,
      );
      if (await pngExistsNonEmpty(outPng)) {
        const frame = await loadPngBytes(new Uint8Array(await readFile(outPng)));
        src.lastGood = frame;
        return frame;
      }
    } catch {
      /* next */
    }
  }

  if (src.lastGood) return src.lastGood;
  for (const frame of src.cache.values()) return frame;

  throw new Error(`extractVideoFrame: no PNG for seek ${sourceMs}ms (${outPng})`);
}

async function loadAnimatedSources(
  doc: CompositionDocument,
  bytesResolver: AssetBytesResolver,
  workDir: string,
): Promise<Map<string, AnimatedSource>> {
  const map = new Map<string, AnimatedSource>();
  const media = doc.objects.filter((o): o is MediaObject => o.type === "media" && (o.kind === "gif" || o.kind === "video"));

  for (const obj of media) {
    const bytes = await bytesResolver(obj.asset_id);
    if (!bytes || bytes.byteLength === 0) {
      throw new Error(
        `encodeComposition requires bytesResolver to return bytes for animated asset "${obj.asset_id}" (${obj.kind})`,
      );
    }
    if (obj.kind === "gif") {
      const decoded = decodeGifBytes(bytes);
      map.set(obj.asset_id, {
        kind: "gif",
        frames: decoded.frames,
        delaysMs: decoded.delaysMs,
        keep: obj.keep,
      });
    } else {
      const ext = bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70 ? "mp4" : "bin";
      const path = join(workDir, `src_${obj.asset_id}.${ext}`);
      await writeFile(path, bytes);
      map.set(obj.asset_id, {
        kind: "video",
        path,
        keep: obj.keep,
        cache: new Map(),
        durationSec: null,
        lastGood: null,
      });
    }
  }
  return map;
}

async function frameAt(
  src: AnimatedSource,
  tMs: number,
  workDir: string,
  ffmpeg: string,
  assetId: string,
): Promise<CanvasImageSource | null> {
  const sourceT = src.keep ? mapCompToSource(src.keep, tMs) : tMs;
  if (sourceT == null) return null;

  if (src.kind === "gif") {
    return gifFrameAt(src.frames, src.delaysMs, sourceT);
  }

  const key = Math.round(sourceT);
  const hit = src.cache.get(key);
  if (hit) return hit;
  const outPng = join(workDir, `v_${assetId}_${key}.png`);
  const frame = await extractVideoFrame(src, sourceT, outPng, ffmpeg);
  src.cache.set(key, frame);
  return frame;
}

function timedResolver(
  frameResolver: AssetResolver,
  overlays: Map<string, CanvasImageSource | null>,
): AssetResolver {
  return async (assetId) => {
    if (overlays.has(assetId)) return overlays.get(assetId) ?? null;
    return frameResolver(assetId);
  };
}

async function buildOverlays(
  animated: Map<string, AnimatedSource>,
  tMs: number,
  workDir: string,
  ffmpeg: string,
): Promise<Map<string, CanvasImageSource | null>> {
  const overlays = new Map<string, CanvasImageSource | null>();
  for (const [id, src] of animated) {
    overlays.set(id, await frameAt(src, tMs, workDir, ffmpeg, id));
  }
  return overlays;
}

async function encodeSilentMp4(
  workDir: string,
  fps: number,
  durationSec: number,
  outPath: string,
  ffmpeg: string,
  crf: number,
): Promise<void> {
  const pattern = join(workDir, "f%05d.png");
  await runFfmpeg(
    [
      "-y",
      "-framerate",
      String(fps),
      "-i",
      pattern,
      "-pix_fmt",
      "yuv420p",
      "-t",
      String(durationSec),
      "-c:v",
      "libx264",
      "-crf",
      String(crf),
      "-an",
      outPath,
    ],
    ffmpeg,
  );
}

async function muxAudio(
  silentMp4: string,
  videoSrc: VideoSource,
  primary: MediaObject,
  durationSec: number,
  outMp4: string,
  ffmpeg: string,
): Promise<boolean> {
  const keep = primary.keep;
  const aStart = (keep?.start_ms ?? 0) / 1000;
  try {
    await runFfmpeg(
      [
        "-y",
        "-i",
        silentMp4,
        "-ss",
        String(aStart),
        "-t",
        String(durationSec),
        "-i",
        videoSrc.path,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0?",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-shortest",
        outMp4,
      ],
      ffmpeg,
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Encode composition derivatives for the BLOB worker.
 * Uses the same `renderFrame` contract as preview.
 * GIF/video frames come from `bytesResolver` (not host-decoded frameResolver).
 * When mute_source is false, muxes trimmed source audio onto the composed mp4.
 * Enforces still ≤2MB, GIF ≤3MB, video ≤12MB.
 * Pass `opts.maxDurationMs` when the composition exceeds the default 10s cap.
 */
export async function encodeComposition(
  doc: CompositionDocument,
  frameResolver: AssetResolver,
  bytesResolver?: AssetBytesResolver,
  opts?: { maxDurationMs?: number },
): Promise<EncodePayload> {
  const maxMs = resolveMaxDurationMs(opts?.maxDurationMs);
  if (doc.duration_ms > maxMs) {
    throw new Error(`duration_ms exceeds ${maxMs}`);
  }

  const animatedNeeded = needsGifExport(doc);
  if (animatedNeeded && !bytesResolver) {
    throw new Error("encodeComposition requires bytesResolver for gif/video compositions");
  }

  const workDir = await mkdtemp(join(tmpdir(), "blob-enc-"));
  const ffmpeg = resolveFfmpeg();
  let hasAudio = false;

  try {
    const animated =
      animatedNeeded && bytesResolver
        ? await loadAnimatedSources(doc, bytesResolver, workDir)
        : new Map<string, AnimatedSource>();

    const overlays0 = await buildOverlays(animated, 0, workDir, ffmpeg);
    const resolver0 = timedResolver(frameResolver, overlays0);

    const fullCanvas = await renderFrame(doc, 0, resolver0);
    const chatCanvas = scaleCanvas(fullCanvas, EXPORT_SIZES.chat);
    const thumbCanvas = scaleCanvas(fullCanvas, EXPORT_SIZES.thumbnail);

    const [chatEnc, thumbEnc, fullEnc] = await Promise.all([
      encodeStillUnderBudget(chatCanvas),
      encodeStillUnderBudget(thumbCanvas),
      encodeStillUnderBudget(fullCanvas),
    ]);

    let mask: Uint8Array | undefined;
    const maskBlob = await renderMaskBlob(doc, resolver0);
    if (maskBlob) mask = await blobToUint8(maskBlob);

    const exports: EncodePayload["exports"] = {
      chat: chatEnc.bytes,
      thumbnail: thumbEnc.bytes,
      full: fullEnc.bytes,
      mask,
    };
    const mimeTypes: EncodePayload["meta"]["mimeTypes"] = {
      chat: chatEnc.mime,
      thumbnail: thumbEnc.mime,
      full: fullEnc.mime,
      mask: mask ? "image/png" : undefined,
    };

    const fps = doc.fps || 15;
    const duration = doc.duration_ms;

    if (duration > 0 && animatedNeeded) {
      const frameCount = Math.max(1, Math.ceil((duration / 1000) * fps));
      const rgbaFrames: { data: Uint8Array; width: number; height: number }[] = [];

      for (let i = 0; i < frameCount; i++) {
        // Prefer last frame not exactly on duration_ms (exclusive trim / EOF)
        const t = Math.min(Math.max(0, duration - 1), (i / fps) * 1000);
        const overlays = await buildOverlays(animated, t, workDir, ffmpeg);
        const resolver = timedResolver(frameResolver, overlays);
        const canvas = await renderFrame(doc, t, resolver);
        const ctx = canvas.getContext("2d", { willReadFrequently: true }) as
          | CanvasRenderingContext2D
          | OffscreenCanvasRenderingContext2D
          | null;
        if (!ctx) throw new Error("2d context unavailable");
        const id = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        rgbaFrames.push({ data: new Uint8Array(id.data.buffer.slice(0)), width: CANVAS_SIZE, height: CANVAS_SIZE });
        await writeFile(join(workDir, `f${String(i).padStart(5, "0")}.png`), await canvasToPngBytes(canvas));
      }

      if (needsGifExport(doc)) {
        const delayCs = Math.max(1, Math.round(100 / fps));
        exports.gif = await encodeGifUnderBudget(rgbaFrames, delayCs);
        mimeTypes.gif = "image/gif";
      }

      if (needsVideo(doc)) {
        const silentMp4 = join(workDir, "silent.mp4");
        const outMp4 = join(workDir, "out.mp4");
        const durationSec = duration / 1000;
        const muted = doc.audio?.mute_source !== false;
        const primary = primaryMedia(doc);
        const videoSrc = primary && animated.get(primary.asset_id);

        // CRF ladder until ≤ MAX_VIDEO_BYTES
        const crfs = [23, 28, 32, 36, 40];
        let videoBytes: Uint8Array | null = null;
        let muxedAudio = false;

        for (const crf of crfs) {
          await encodeSilentMp4(workDir, fps, durationSec, silentMp4, ffmpeg, crf);

          if (!muted && videoSrc && videoSrc.kind === "video" && primary) {
            const ok = await muxAudio(silentMp4, videoSrc, primary, durationSec, outMp4, ffmpeg);
            if (ok) {
              videoBytes = new Uint8Array(await readFile(outMp4));
              muxedAudio = true;
            } else {
              videoBytes = new Uint8Array(await readFile(silentMp4));
              muxedAudio = false;
            }
          } else {
            videoBytes = new Uint8Array(await readFile(silentMp4));
            muxedAudio = false;
          }

          if (videoBytes.byteLength <= MAX_VIDEO_BYTES) break;
          videoBytes = null;
        }

        if (!videoBytes) {
          throw new Error(`Video encode exceeds ${MAX_VIDEO_BYTES} bytes after CRF ladder`);
        }
        exports.video = videoBytes;
        hasAudio = muxedAudio;
        mimeTypes.video = "video/mp4";
      }
    }

    return {
      document: doc,
      exports,
      meta: {
        background: doc.canvas.background,
        width: CANVAS_SIZE,
        height: CANVAS_SIZE,
        duration_ms: doc.duration_ms,
        has_audio: hasAudio,
        mimeTypes,
      },
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function compositionNeedsAnimatedEncode(doc: CompositionDocument): boolean {
  return needsGif(doc) || needsVideo(doc);
}

export function primaryMedia(doc: CompositionDocument): MediaObject | undefined {
  return doc.objects.find((o): o is MediaObject => o.type === "media");
}

export type { EncodePayload, AssetBytesResolver };
