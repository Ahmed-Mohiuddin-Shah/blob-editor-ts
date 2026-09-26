/**
 * GIF decode + frame-at-t (browser + Node). Shared by React stage and encode.
 */

import { GifReader } from "omggif";
import { MAX_DURATION_MS } from "./types.js";

export type GifFrameCanvas = HTMLCanvasElement | OffscreenCanvas;

export interface DecodedGif {
  frames: GifFrameCanvas[];
  delaysMs: number[];
  totalMs: number;
  width: number;
  height: number;
}

function makeCanvas(w: number, h: number): GifFrameCanvas {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(w, h);
  }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function canvasFromRgba(w: number, h: number, rgba: Uint8ClampedArray): GifFrameCanvas {
  const c = makeCanvas(w, h);
  const ctx = c.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error("2d context unavailable");
  const img = ctx.createImageData(w, h);
  img.data.set(rgba);
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Decode animated GIF bytes into full composited frames + delays.
 * Disposal handled via scratch buffer (omggif blit).
 */
export function decodeGifBytes(bytes: Uint8Array): DecodedGif {
  const reader = new GifReader(bytes);
  const w = reader.width;
  const h = reader.height;
  const frameCount = reader.numFrames();
  const frames: GifFrameCanvas[] = [];
  const delaysMs: number[] = [];

  const scratch = new Uint8ClampedArray(w * h * 4);
  const prev = new Uint8ClampedArray(w * h * 4);

  for (let i = 0; i < frameCount; i++) {
    const info = reader.frameInfo(i);
    const delayCs = info.delay || 10; // centiseconds; 0 → 100ms
    delaysMs.push(Math.max(10, delayCs * 10));

    prev.set(scratch);
    reader.decodeAndBlitFrameRGBA(i, scratch);
    frames.push(canvasFromRgba(w, h, new Uint8ClampedArray(scratch)));

    const disposal = info.disposal;
    if (disposal === 2) {
      const { x, y, width: fw, height: fh } = info;
      for (let row = y; row < y + fh; row++) {
        for (let col = x; col < x + fw; col++) {
          const idx = (row * w + col) * 4;
          scratch[idx] = scratch[idx + 1] = scratch[idx + 2] = scratch[idx + 3] = 0;
        }
      }
    } else if (disposal === 3) {
      scratch.set(prev);
    }
  }

  const rawTotal = delaysMs.reduce((a, b) => a + b, 0);
  const totalMs = Math.min(MAX_DURATION_MS, Math.max(0, rawTotal));

  return { frames, delaysMs, totalMs, width: w, height: h };
}

/** Pick frame for source time (loops within total delay sum). */
export function gifFrameAt<T>(frames: T[], delaysMs: number[], tMs: number): T {
  if (frames.length === 0) throw new Error("no gif frames");
  if (frames.length === 1) return frames[0]!;
  const total = delaysMs.reduce((a, b) => a + b, 0);
  if (total <= 0) return frames[0]!;
  let t = tMs % total;
  if (t < 0) t += total;
  let acc = 0;
  for (let i = 0; i < frames.length; i++) {
    acc += delaysMs[i] ?? 0;
    if (t < acc) return frames[i]!;
  }
  return frames[frames.length - 1]!;
}
