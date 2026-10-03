/**
 * Budgeted GIF encode (browser + Node). Shared by encodeComposition + prepareSourceMedia.
 * Optional dep: `gifenc`.
 */

import { GIF_ENCODE_MAX_EDGE, MAX_GIF_BYTES } from "./types.js";

type GifencMod = {
  GIFEncoder: () => {
    writeFrame: (i: Uint8Array, w: number, h: number, o: object) => void;
    finish: () => void;
    bytes: () => Uint8Array;
  };
  quantize: (d: Uint8Array, n: number) => number[][];
  applyPalette: (d: Uint8Array, p: number[][]) => Uint8Array;
};

let gifencMod: GifencMod | null = null;

async function loadGifenc(): Promise<GifencMod> {
  if (gifencMod) return gifencMod;
  try {
    const m = (await import("gifenc")) as GifencMod & { default?: GifencMod["GIFEncoder"] };
    gifencMod = {
      GIFEncoder: m.GIFEncoder ?? m.default!,
      quantize: m.quantize,
      applyPalette: m.applyPalette,
    };
    return gifencMod;
  } catch {
    throw new Error("GIF encode requires optional dependency `gifenc`");
  }
}

export type RgbaFrame = { data: Uint8Array; width: number; height: number };

/** Nearest-neighbor downscale to fit maxEdge. */
export function downscaleRgba(frame: RgbaFrame, maxEdge: number): RgbaFrame {
  const { width: w, height: h, data } = frame;
  if (w <= maxEdge && h <= maxEdge) return frame;
  const scale = Math.min(maxEdge / w, maxEdge / h);
  const nw = Math.max(1, Math.round(w * scale));
  const nh = Math.max(1, Math.round(h * scale));
  const out = new Uint8Array(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(h - 1, Math.floor((y + 0.5) * (h / nh)));
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(w - 1, Math.floor((x + 0.5) * (w / nw)));
      const si = (sy * w + sx) * 4;
      const di = (y * nw + x) * 4;
      out[di] = data[si]!;
      out[di + 1] = data[si + 1]!;
      out[di + 2] = data[si + 2]!;
      out[di + 3] = data[si + 3]!;
    }
  }
  return { data: out, width: nw, height: nh };
}

function encodeOnce(
  mod: GifencMod,
  frames: RgbaFrame[],
  delayCs: number,
  colors: number,
): Uint8Array {
  const gif = mod.GIFEncoder();
  // Sample multiple frames so shared palette covers the full animation (not just frame 0)
  const sampleStep = Math.max(1, Math.floor(frames.length / 8));
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let i = 0; i < frames.length; i += sampleStep) {
    chunks.push(frames[i]!.data);
    total += frames[i]!.data.length;
  }
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.length;
  }
  const palette = mod.quantize(merged, colors);
  for (const f of frames) {
    const index = mod.applyPalette(f.data, palette);
    gif.writeFrame(index, f.width, f.height, { palette, delay: delayCs });
  }
  gif.finish();
  return gif.bytes();
}

/**
 * Encode RGBA frames as GIF under MAX_GIF_BYTES.
 * Downscales to ≤maxEdge (default GIF_ENCODE_MAX_EDGE), shared palette, then reduces colors / drops frames.
 */
export async function encodeGifUnderBudget(
  frames: RgbaFrame[],
  delayCs: number,
  maxBytes = MAX_GIF_BYTES,
  maxEdge: number = GIF_ENCODE_MAX_EDGE,
): Promise<Uint8Array> {
  if (!frames.length) throw new Error("encodeGifUnderBudget: no frames");
  const mod = await loadGifenc();
  const edge = Math.max(1, maxEdge);

  let working = frames.map((f) => downscaleRgba(f, edge));
  let delay = Math.max(1, delayCs);
  const colorSteps = [256, 128, 64, 32];

  for (const colors of colorSteps) {
    const bytes = encodeOnce(mod, working, delay, colors);
    if (bytes.byteLength <= maxBytes) return bytes;
  }

  while (working.length > 1) {
    const next: RgbaFrame[] = [];
    for (let i = 0; i < working.length; i += 2) next.push(working[i]!);
    working = next;
    delay = Math.min(100, delay * 2);
    for (const colors of [64, 32]) {
      const bytes = encodeOnce(mod, working, delay, colors);
      if (bytes.byteLength <= maxBytes) return bytes;
    }
  }

  const tiny = downscaleRgba(working[0]!, 256);
  const last = encodeOnce(mod, [tiny], delay, 16);
  if (last.byteLength <= maxBytes) return last;
  throw new Error(`GIF encode exceeds ${maxBytes} bytes after budget reductions`);
}
