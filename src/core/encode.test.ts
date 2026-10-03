import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { loadImage } from "canvas";
import { GifReader, GifWriter } from "omggif";
import { decodeGifBytes, gifFrameAt } from "./gif.js";
import { encodeGifUnderBudget } from "./gif-encode.js";
import { encodeComposition, compositionNeedsAnimatedEncode } from "./encode.js";
import { createFromSource, addText, setTrim, updateTransform } from "./ops.js";

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

const require = createRequire(import.meta.url);

function resolveFfmpeg(): string | null {
  try {
    return require("ffmpeg-static") as string;
  } catch {
    const r = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
    return r.status === 0 ? "ffmpeg" : null;
  }
}

function makeTwoToneGif(delayCs = 50): Uint8Array {
  const buf = Buffer.alloc(4096);
  const w = new GifWriter(buf, 4, 4, { palette: [0xff0000, 0x0000ff], loop: 0 });
  w.addFrame(0, 0, 4, 4, new Array(16).fill(0), { delay: delayCs });
  w.addFrame(0, 0, 4, 4, new Array(16).fill(1), { delay: delayCs });
  return new Uint8Array(buf.buffer, buf.byteOffset, w.end());
}

function gifDelayCsSum(bytes: Uint8Array): number {
  const reader = new GifReader(Buffer.from(bytes));
  let sum = 0;
  for (let i = 0; i < reader.numFrames(); i++) sum += reader.frameInfo(i).delay || 0;
  return sum;
}

function probeMp4DurationMs(bytes: Uint8Array, ffmpeg: string): number {
  const tmp = join(tmpdir(), `blob-probe-${process.pid}-${Date.now()}.mp4`);
  writeFileSync(tmp, bytes);
  try {
    const r = spawnSync(ffmpeg, ["-i", tmp], { encoding: "utf8" });
    const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.stderr ?? "");
    if (!m) throw new Error(`no duration in ffmpeg stderr: ${r.stderr}`);
    return (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000;
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

async function makeColorMp4(durationSec: number): Promise<Uint8Array> {
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) throw new Error("ffmpeg unavailable");
  const dir = await mkdtemp(join(tmpdir(), "blob-vid-"));
  try {
    const out = join(dir, "t.mp4");
    const r = spawnSync(
      ffmpeg,
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `color=c=red:s=64x64:d=${durationSec}`,
        "-pix_fmt",
        "yuv420p",
        "-t",
        String(durationSec),
        out,
      ],
      { encoding: "utf8" },
    );
    if (r.status !== 0) throw new Error(`ffmpeg mp4 fixture failed: ${r.stderr}`);
    return new Uint8Array(await readFile(out));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function makeTinyMp4(): Promise<Uint8Array> {
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) throw new Error("ffmpeg unavailable");
  const dir = await mkdtemp(join(tmpdir(), "blob-vid-"));
  try {
    const out = join(dir, "t.mp4");
    const r = spawnSync(
      ffmpeg,
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=red:s=64x64:d=0.5",
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=64x64:d=0.5",
        "-filter_complex",
        "[0][1]concat=n=2:v=1:a=0",
        "-pix_fmt",
        "yuv420p",
        "-t",
        "1",
        out,
      ],
      { encoding: "utf8" },
    );
    if (r.status !== 0) throw new Error(`ffmpeg mp4 fixture failed: ${r.stderr}`);
    return new Uint8Array(await readFile(out));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function meanChannel(rgba: Uint8ClampedArray | Uint8Array, channel: 0 | 1 | 2, step = 16): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < rgba.length; i += 4 * step) {
    sum += rgba[i + channel]!;
    n++;
  }
  return n ? sum / n : 0;
}

async function pngMeanRed(png: Uint8Array): Promise<number> {
  const img = await loadImage(Buffer.from(png));
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img as unknown as CanvasImageSource, 0, 0);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  return meanChannel(data, 0);
}

async function pngLumaVariance(png: Uint8Array): Promise<number> {
  const img = await loadImage(Buffer.from(png));
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img as unknown as CanvasImageSource, 0, 0);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 16) {
    const y = data[i]! * 0.3 + data[i + 1]! * 0.6 + data[i + 2]! * 0.1;
    sum += y;
    sum2 += y * y;
    n++;
  }
  const mean = sum / n;
  return sum2 / n - mean * mean;
}

async function gifFrameMeans(gifBytes: Uint8Array): Promise<number[]> {
  const decoded = decodeGifBytes(gifBytes);
  return decoded.frames.map((f) => {
    const ctx = f.getContext("2d") as CanvasRenderingContext2D;
    const { data } = ctx.getImageData(0, 0, f.width, f.height);
    return meanChannel(data, 0);
  });
}

describe("gif decode", () => {
  it("decodeGifBytes reads multi-frame delays and duration", () => {
    const bytes = makeTwoToneGif();
    const d = decodeGifBytes(bytes);
    expect(d.frames.length).toBe(2);
    expect(d.delaysMs).toEqual([500, 500]);
    expect(d.totalMs).toBe(1000);
  });

  it("gifFrameAt picks by delay timeline", () => {
    const frames = ["a", "b", "c"];
    const delays = [100, 100, 100];
    expect(gifFrameAt(frames, delays, 0)).toBe("a");
    expect(gifFrameAt(frames, delays, 99)).toBe("a");
    expect(gifFrameAt(frames, delays, 100)).toBe("b");
    expect(gifFrameAt(frames, delays, 250)).toBe("c");
    expect(gifFrameAt(frames, delays, 300)).toBe("a");
  });
});

describe("encodeComposition", () => {
  const ffmpeg = resolveFfmpeg();
  let gifencOk = false;
  try {
    require("gifenc");
    gifencOk = true;
  } catch {
    gifencOk = false;
  }

  it("static image: stills + firstFramePng, no gif/video", async () => {
    const doc = createFromSource("img1", 1, 1, "#ffffff", { kind: "image" });
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 1, 1);

    const result = await encodeComposition(doc, async (id) => (id === "img1" ? c : null));
    expect(result.exports.full.byteLength).toBeGreaterThan(20);
    expect(result.exports.gif).toBeUndefined();
    expect(result.exports.video).toBeUndefined();
    expect(result.meta.mimeTypes.chat).toMatch(/^image\//);
    expect(result.meta.mimeTypes.thumbnail).toMatch(/^image\//);
    expect(result.meta.mimeTypes.full).toMatch(/^image\//);
    expect(result.meta.mimeTypes.chat).not.toBe("image/gif");
    expect(result.meta.firstFramePng).toBeDefined();
    expect(isPng(result.meta.firstFramePng!)).toBe(true);
    expect(compositionNeedsAnimatedEncode(doc)).toBe(false);
  });

  it.skipIf(!gifencOk)("GIF roundtrip: matrix gif slots + distinct frames", async () => {
    const gifBytes = makeTwoToneGif();
    const decoded = decodeGifBytes(gifBytes);
    const doc = createFromSource("g1", decoded.width, decoded.height, "transparent", {
      kind: "gif",
      durationMs: decoded.totalMs,
      fps: 2,
    });

    const result = await encodeComposition(
      doc,
      async () => null,
      async (id) => (id === "g1" ? gifBytes : null),
    );
    expect(result.exports.gif).toBeDefined();
    expect(result.meta.mimeTypes.chat).toBe("image/gif");
    expect(result.meta.mimeTypes.thumbnail).toBe("image/gif");
    expect(result.meta.mimeTypes.full).toBe("image/gif");
    expect(result.meta.mimeTypes.gif).toBe("image/gif");
    expect(result.meta.firstFramePng).toBeDefined();
    expect(isPng(result.meta.firstFramePng!)).toBe(true);
    expect(result.meta.duration_ms).toBe(1000);
    const means = await gifFrameMeans(result.exports.gif!);
    expect(means.length).toBeGreaterThanOrEqual(2);
    const mid = Math.floor(means.length / 2);
    const early = means.slice(0, Math.max(1, mid)).reduce((a, b) => a + b, 0) / Math.max(1, mid);
    const late = means.slice(mid).reduce((a, b) => a + b, 0) / Math.max(1, means.length - mid);
    expect(early).toBeGreaterThan(late + 20);
  });

  it.skipIf(!gifencOk)("GIF trim: keep selects later source frames", async () => {
    const gifBytes = makeTwoToneGif();
    const decoded = decodeGifBytes(gifBytes);
    let doc = createFromSource("g1", decoded.width, decoded.height, "transparent", {
      kind: "gif",
      durationMs: decoded.totalMs,
      fps: 2,
    });
    doc = setTrim(doc, doc.objects[0]!.id, 500, 1000);

    const result = await encodeComposition(
      doc,
      async () => null,
      async (id) => (id === "g1" ? gifBytes : null),
    );
    expect(result.exports.gif).toBeDefined();
    const means = await gifFrameMeans(result.exports.gif!);
    const avg = means.reduce((a, b) => a + b, 0) / means.length;
    expect(avg).toBeLessThan(80);
  });

  it.skipIf(!ffmpeg || !gifencOk)(
    "Video matrix: thumb gif, chat+full mp4, firstFramePng",
    async () => {
      const mp4 = await makeTinyMp4();
      const doc = createFromSource("v1", 64, 64, "#000000", {
        kind: "video",
        durationMs: 1000,
        fps: 4,
      });
      const result = await encodeComposition(
        doc,
        async () => null,
        async (id) => (id === "v1" ? mp4 : null),
      );
      expect(result.meta.mimeTypes.thumbnail).toBe("image/gif");
      expect(result.meta.mimeTypes.chat).toBe("video/mp4");
      expect(result.meta.mimeTypes.full).toBe("video/mp4");
      expect(result.meta.mimeTypes.video).toBe("video/mp4");
      expect(result.meta.mimeTypes.gif).toBe("image/gif");
      expect(result.exports.video).toBeDefined();
      expect(result.exports.video!.byteLength).toBeGreaterThan(500);
      expect(result.exports.gif).toBeDefined();
      expect(result.meta.firstFramePng).toBeDefined();
      expect(isPng(result.meta.firstFramePng!)).toBe(true);
      expect(await pngMeanRed(result.meta.firstFramePng!)).toBeGreaterThan(20);
      const gifMeans = await gifFrameMeans(result.exports.gif!);
      expect(gifMeans.some((m) => m > 20)).toBe(true);
    },
  );

  it.skipIf(!ffmpeg || !gifencOk)("Video with text shows composed result", async () => {
    const mp4 = await makeTinyMp4();
    let doc = createFromSource("v1", 64, 64, "#000000", {
      kind: "video",
      durationMs: 500,
      fps: 2,
    });
    doc = addText(doc, { text: "HI", font_size: 120 });
    const textObj = doc.objects.find((o) => o.type === "text")!;
    doc = updateTransform(doc, textObj.id, { x: 512, y: 512 });

    const result = await encodeComposition(
      doc,
      async () => null,
      async (id) => (id === "v1" ? mp4 : null),
    );
    expect(result.exports.gif).toBeDefined();
    expect(result.meta.firstFramePng).toBeDefined();
    expect(await pngLumaVariance(result.meta.firstFramePng!)).toBeGreaterThan(100);
  });

  it.skipIf(!ffmpeg || !gifencOk)("Video seek at last ms does not ENOENT", async () => {
    const mp4 = await makeTinyMp4();
    // 1s source, sample last frame near EOF (was ENOENT with input -ss)
    const doc = createFromSource("v1", 64, 64, "#000000", {
      kind: "video",
      durationMs: 1000,
      fps: 15,
    });
    const result = await encodeComposition(
      doc,
      async () => null,
      async (id) => (id === "v1" ? mp4 : null),
    );
    expect(result.exports.video).toBeDefined();
    expect(result.exports.video!.byteLength).toBeGreaterThan(500);
    expect(result.exports.gif).toBeDefined();
    expect(result.exports.video!.byteLength).toBeLessThanOrEqual(12 * 1024 * 1024);
  });

  it.skipIf(!gifencOk)("GIF encode stays ≤ 3MB", async () => {
    const gifBytes = makeTwoToneGif();
    const decoded = decodeGifBytes(gifBytes);
    const doc = createFromSource("g1", decoded.width, decoded.height, "transparent", {
      kind: "gif",
      durationMs: 2000,
      fps: 8,
    });
    const result = await encodeComposition(
      doc,
      async () => null,
      async (id) => (id === "g1" ? gifBytes : null),
    );
    expect(result.exports.gif).toBeDefined();
    expect(result.exports.gif!.byteLength).toBeLessThanOrEqual(3 * 1024 * 1024);
  }, 30_000);

  it.skipIf(!ffmpeg || !gifencOk)("Video encode stays ≤ 12MB", async () => {
    const mp4 = await makeTinyMp4();
    const doc = createFromSource("v1", 64, 64, "#000000", {
      kind: "video",
      durationMs: 2000,
      fps: 8,
    });
    const result = await encodeComposition(
      doc,
      async () => null,
      async (id) => (id === "v1" ? mp4 : null),
    );
    expect(result.exports.video).toBeDefined();
    expect(result.exports.video!.byteLength).toBeLessThanOrEqual(12 * 1024 * 1024);
  }, 30_000);

  it.skipIf(!gifencOk)("2s GIF + 10s doc encodes ~2s, not padded", async () => {
    const gifBytes = makeTwoToneGif(100);
    const decoded = decodeGifBytes(gifBytes);
    expect(decoded.totalMs).toBe(2000);
    const doc = createFromSource("g1", decoded.width, decoded.height, "transparent", {
      kind: "gif",
      durationMs: 10_000,
      fps: 4,
    });
    const result = await encodeComposition(
      doc,
      async () => null,
      async (id) => (id === "g1" ? gifBytes : null),
    );
    expect(result.meta.duration_ms).toBe(2000);
    expect(decodeGifBytes(result.exports.gif!).totalMs).toBeLessThanOrEqual(2500);
    expect(decodeGifBytes(result.exports.gif!).totalMs).toBeGreaterThanOrEqual(1500);
  }, 30_000);

  it.skipIf(!ffmpeg || !gifencOk)("2s video + 10s doc encodes ~2s, not padded", async () => {
    const mp4 = await makeColorMp4(2);
    const doc = createFromSource("v1", 64, 64, "#000000", {
      kind: "video",
      durationMs: 10_000,
      fps: 2,
    });
    const result = await encodeComposition(
      doc,
      async () => null,
      async (id) => (id === "v1" ? mp4 : null),
    );
    expect(result.meta.duration_ms).toBeGreaterThanOrEqual(1800);
    expect(result.meta.duration_ms).toBeLessThanOrEqual(2200);
    const outMs = probeMp4DurationMs(result.exports.video!, ffmpeg!);
    expect(outMs).toBeGreaterThanOrEqual(1500);
    expect(outMs).toBeLessThanOrEqual(2500);
  }, 30_000);

  it.skipIf(!ffmpeg || !gifencOk)("15s video + 10s cap trims ~10s at 1x", async () => {
    const mp4 = await makeColorMp4(15);
    const doc = createFromSource("v1", 64, 64, "#000000", {
      kind: "video",
      durationMs: 10_000,
      fps: 2,
    });
    const result = await encodeComposition(
      doc,
      async () => null,
      async (id) => (id === "v1" ? mp4 : null),
    );
    expect(result.meta.duration_ms).toBeGreaterThanOrEqual(9500);
    expect(result.meta.duration_ms).toBeLessThanOrEqual(10_000);
    const outMs = probeMp4DurationMs(result.exports.video!, ffmpeg!);
    expect(outMs).toBeGreaterThanOrEqual(9000);
    expect(outMs).toBeLessThanOrEqual(11_000);
  }, 60_000);
});

describe("encodeGifUnderBudget", () => {
  let gifencOk = false;
  try {
    require("gifenc");
    gifencOk = true;
  } catch {
    gifencOk = false;
  }

  it.skipIf(!gifencOk)("maxEdge 128 produces dimensions ≤128", async () => {
    const frame = {
      data: new Uint8Array(256 * 256 * 4).fill(200),
      width: 256,
      height: 256,
    };
    const bytes = await encodeGifUnderBudget([frame], 7, undefined, 128);
    const reader = new GifReader(Buffer.from(bytes));
    expect(reader.width).toBeLessThanOrEqual(128);
    expect(reader.height).toBeLessThanOrEqual(128);
  });

  it.skipIf(!gifencOk)("dropping frames keeps total delay", async () => {
    const n = 16;
    const delayCs = 8;
    const frames = Array.from({ length: n }, (_, i) => {
      const data = new Uint8Array(48 * 48 * 4);
      for (let p = 0; p < data.length; p += 4) {
        data[p] = (i * 17 + p) % 256;
        data[p + 1] = (i * 31) % 256;
        data[p + 2] = (p / 4) % 256;
        data[p + 3] = 255;
      }
      return { data, width: 48, height: 48 };
    });
    const bytes = await encodeGifUnderBudget(frames, delayCs, 2_500, 48);
    const reader = new GifReader(Buffer.from(bytes));
    expect(reader.numFrames()).toBeLessThan(n);
    expect(gifDelayCsSum(bytes)).toBe(delayCs * n);
  });
});
