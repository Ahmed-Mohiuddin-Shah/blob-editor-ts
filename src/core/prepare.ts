/**
 * Browser helper: compress image/gif/video under derivative budgets before upload.
 * Host only awaits + shows busy via onProgress — no ffmpeg wiring.
 */

import { decodeGifBytes } from "./gif.js";
import { encodeGifUnderBudget, type RgbaFrame } from "./gif-encode.js";
import {
  MAX_DURATION_MS,
  MAX_GIF_BYTES,
  MAX_STILL_BYTES,
  MAX_VIDEO_BYTES,
  type MediaKind,
} from "./types.js";

export type PrepareProgressPhase = "decode" | "compress" | "done";

export type PrepareProgress = {
  phase: PrepareProgressPhase;
  /** 0–1 */
  ratio: number;
};

export type PrepareSourceResult = {
  file: File;
  kind: MediaKind;
  width: number;
  height: number;
  durationMs?: number;
};

export type PrepareSourceOpts = {
  onProgress?: (p: PrepareProgress) => void;
};

function progress(opts: PrepareSourceOpts | undefined, phase: PrepareProgressPhase, ratio: number) {
  opts?.onProgress?.({ phase, ratio: Math.max(0, Math.min(1, ratio)) });
}

async function readFileBytes(file: Blob): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === "function") {
    return new Uint8Array(await file.arrayBuffer());
  }
  // jsdom File lacks arrayBuffer / stream — FileReader works
  if (typeof FileReader !== "undefined") {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(new Uint8Array(fr.result as ArrayBuffer));
      fr.onerror = () => reject(fr.error ?? new Error("FileReader failed"));
      fr.readAsArrayBuffer(file);
    });
  }
  return new Uint8Array(await new Response(file).arrayBuffer());
}

function sniffKind(file: File): MediaKind {
  const t = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();
  if (t === "image/gif" || name.endsWith(".gif")) return "gif";
  if (t.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/.test(name)) return "video";
  return "image";
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

async function blobToFile(blob: Blob, name: string, type: string): Promise<File> {
  return new File([blob], name, { type: type || blob.type });
}

function hasAlphaData(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i]! < 255) return true;
  }
  return false;
}

async function canvasToBlob(c: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), mime, quality);
  });
}

async function compressImageCanvas(
  c: HTMLCanvasElement,
  maxBytes: number,
): Promise<{ blob: Blob; mime: string }> {
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2d context unavailable");
  const sample = ctx.getImageData(0, 0, Math.min(64, c.width), Math.min(64, c.height));
  const alpha = hasAlphaData(sample.data);

  const png = await canvasToBlob(c, "image/png");
  if (png.size <= maxBytes) return { blob: png, mime: "image/png" };

  const qualities = [0.92, 0.8, 0.65, 0.5, 0.35];
  if (alpha) {
    for (const q of qualities) {
      try {
        const webp = await canvasToBlob(c, "image/webp", q);
        if (webp.size <= maxBytes) return { blob: webp, mime: "image/webp" };
      } catch {
        /* unsupported */
      }
    }
  }
  for (const q of qualities) {
    const jpeg = await canvasToBlob(c, "image/jpeg", q);
    if (jpeg.size <= maxBytes) return { blob: jpeg, mime: "image/jpeg" };
  }

  for (const scale of [0.75, 0.5, 0.35]) {
    const w = Math.max(1, Math.round(c.width * scale));
    const h = Math.max(1, Math.round(c.height * scale));
    const s = makeCanvas(w, h);
    const sctx = s.getContext("2d")!;
    sctx.drawImage(c, 0, 0, w, h);
    for (const q of qualities) {
      const mime = alpha ? "image/webp" : "image/jpeg";
      try {
        const b = await canvasToBlob(s, mime, q);
        if (b.size <= maxBytes) return { blob: b, mime };
      } catch {
        const b = await canvasToBlob(s, "image/jpeg", q);
        if (b.size <= maxBytes) return { blob: b, mime: "image/jpeg" };
      }
    }
  }
  throw new Error(`Image compress exceeds ${maxBytes} bytes`);
}

async function decodeImageFile(file: File): Promise<{
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}> {
  const bytes = await readFileBytes(file);

  // node-canvas Image accepts a Buffer as src
  if (typeof Buffer !== "undefined" && typeof Image !== "undefined") {
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("image decode failed"));
        (el as unknown as { src: Buffer }).src = Buffer.from(bytes);
      });
      return {
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
      };
    } catch {
      /* fall through */
    }
  }

  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(
        new Blob([bytes.slice()], { type: file.type || "image/png" }),
      );
      return {
        width: bmp.width,
        height: bmp.height,
        draw: (ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h),
      };
    } catch {
      /* fall through */
    }
  }

  const b64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(bytes).toString("base64")
      : btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
  const mime = file.type || "image/png";
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("image decode failed"));
    el.src = `data:${mime};base64,${b64}`;
  });
  return {
    width: img.naturalWidth || img.width,
    height: img.naturalHeight || img.height,
    draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
  };
}

async function prepareImage(file: File, opts?: PrepareSourceOpts): Promise<PrepareSourceResult> {
  progress(opts, "decode", 0.1);
  const decoded = await decodeImageFile(file);
  progress(opts, "decode", 0.4);
  const c = makeCanvas(decoded.width, decoded.height);
  const ctx = c.getContext("2d")!;
  decoded.draw(ctx, c.width, c.height);

  if (file.size <= MAX_STILL_BYTES) {
    progress(opts, "compress", 0.9);
    progress(opts, "done", 1);
    return { file, kind: "image", width: c.width, height: c.height };
  }

  progress(opts, "compress", 0.5);
  const { blob, mime } = await compressImageCanvas(c, MAX_STILL_BYTES);
  progress(opts, "compress", 0.9);
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const out = await blobToFile(blob, file.name.replace(/\.[^.]+$/, "") + `.${ext}`, mime);
  progress(opts, "done", 1);
  return { file: out, kind: "image", width: c.width, height: c.height };
}

async function prepareGif(file: File, opts?: PrepareSourceOpts): Promise<PrepareSourceResult> {
  progress(opts, "decode", 0.1);
  const bytes = await readFileBytes(file);
  const decoded = decodeGifBytes(bytes);
  progress(opts, "decode", 0.5);

  let total = 0;
  const frames: RgbaFrame[] = [];
  const delays: number[] = [];
  for (let i = 0; i < decoded.frames.length; i++) {
    const d = decoded.delaysMs[i] ?? 100;
    if (total + d > MAX_DURATION_MS && frames.length > 0) break;
    const canvas = decoded.frames[i]!;
    const ctx = canvas.getContext("2d", { willReadFrequently: true }) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) throw new Error("2d context unavailable");
    const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
    frames.push({ data: new Uint8Array(id.data.buffer.slice(0)), width: canvas.width, height: canvas.height });
    delays.push(d);
    total += d;
  }

  const avgDelay = delays.reduce((a, b) => a + b, 0) / Math.max(1, delays.length);
  const delayCs = Math.max(1, Math.round(avgDelay / 10));

  if (file.size <= MAX_GIF_BYTES && total <= MAX_DURATION_MS && frames.length === decoded.frames.length) {
    progress(opts, "compress", 0.9);
    progress(opts, "done", 1);
    return {
      file,
      kind: "gif",
      width: decoded.width,
      height: decoded.height,
      durationMs: Math.min(MAX_DURATION_MS, decoded.totalMs),
    };
  }

  progress(opts, "compress", 0.4);
  const outBytes = await encodeGifUnderBudget(frames, delayCs, MAX_GIF_BYTES);
  progress(opts, "compress", 0.9);
    const out = await blobToFile(
      new Blob([outBytes.slice()], { type: "image/gif" }),
      file.name.replace(/\.[^.]+$/, "") + ".gif",
      "image/gif",
    );
  progress(opts, "done", 1);
  return {
    file: out,
    kind: "gif",
    width: frames[0]?.width ?? decoded.width,
    height: frames[0]?.height ?? decoded.height,
    durationMs: Math.min(MAX_DURATION_MS, total),
  };
}

function pickRecorderMime(): string {
  const candidates = ["video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  for (const m of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "video/webm";
}

async function recordTrimmedVideo(
  video: HTMLVideoElement,
  maxMs: number,
  videoBitsPerSecond: number,
): Promise<{ blob: Blob; mime: string; width: number; height: number }> {
  const mime = pickRecorderMime();
  const stream =
    typeof (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream === "function"
      ? (video as HTMLVideoElement & { captureStream: () => MediaStream }).captureStream()
      : null;
  if (!stream) throw new Error("captureStream unavailable for video prepare");

  const chunks: Blob[] = [];
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond });
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };

  video.currentTime = 0;
  await video.play();

  const done = new Promise<Blob>((resolve, reject) => {
    rec.onerror = () => reject(new Error("MediaRecorder failed"));
    rec.onstop = () => resolve(new Blob(chunks, { type: mime.split(";")[0] }));
  });

  rec.start(200);
  const end = Math.min(maxMs, (video.duration || maxMs / 1000) * 1000);
  await new Promise<void>((r) => setTimeout(r, end));
  if (rec.state !== "inactive") rec.stop();
  video.pause();

  const blob = await done;
  return {
    blob,
    mime: mime.split(";")[0]!,
    width: video.videoWidth,
    height: video.videoHeight,
  };
}

async function prepareVideo(file: File, opts?: PrepareSourceOpts): Promise<PrepareSourceResult> {
  progress(opts, "decode", 0.1);
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("video decode failed"));
    });
    progress(opts, "decode", 0.4);

    const durationMs = Math.round((video.duration || 0) * 1000);
    const needsTrim = durationMs > MAX_DURATION_MS;
    const underSize = file.size <= MAX_VIDEO_BYTES;

    if (!needsTrim && underSize) {
      progress(opts, "compress", 0.9);
      progress(opts, "done", 1);
      return {
        file,
        kind: "video",
        width: video.videoWidth,
        height: video.videoHeight,
        durationMs: Math.min(MAX_DURATION_MS, durationMs),
      };
    }

    if (typeof MediaRecorder === "undefined") {
      throw new Error("prepareSourceMedia video requires MediaRecorder");
    }

    const bitrates = [4_000_000, 2_000_000, 1_000_000, 500_000, 250_000];
    let last: { blob: Blob; mime: string; width: number; height: number } | null = null;
    for (let i = 0; i < bitrates.length; i++) {
      progress(opts, "compress", 0.3 + (i / bitrates.length) * 0.5);
      last = await recordTrimmedVideo(video, MAX_DURATION_MS, bitrates[i]!);
      if (last.blob.size <= MAX_VIDEO_BYTES) break;
    }
    if (!last || last.blob.size > MAX_VIDEO_BYTES) {
      throw new Error(`Video compress exceeds ${MAX_VIDEO_BYTES} bytes`);
    }

    const ext = last.mime.includes("mp4") ? "mp4" : "webm";
    const out = await blobToFile(last.blob, file.name.replace(/\.[^.]+$/, "") + `.${ext}`, last.mime);
    progress(opts, "done", 1);
    return {
      file: out,
      kind: "video",
      width: last.width,
      height: last.height,
      durationMs: Math.min(MAX_DURATION_MS, durationMs),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Compress source media under sticker budgets before host upload.
 * Image ≤2MB, GIF ≤3MB + ≤10s, video ≤12MB + ≤10s.
 */
export async function prepareSourceMedia(
  file: File,
  opts?: PrepareSourceOpts,
): Promise<PrepareSourceResult> {
  const kind = sniffKind(file);
  progress(opts, "decode", 0);
  if (kind === "gif") return prepareGif(file, opts);
  if (kind === "video") return prepareVideo(file, opts);
  return prepareImage(file, opts);
}
