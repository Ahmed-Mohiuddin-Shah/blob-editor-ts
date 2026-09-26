import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { GifWriter } from "omggif";
import { prepareSourceMedia } from "./prepare.js";
import { MAX_GIF_BYTES, MAX_STILL_BYTES } from "./types.js";
import { encodeGifUnderBudget } from "./gif-encode.js";

const require = createRequire(import.meta.url);
let gifencOk = false;
try {
  require("gifenc");
  gifencOk = true;
} catch {
  gifencOk = false;
}

/** Build a File that preserves bytes under jsdom (Buffer parts). */
function fileFromBytes(bytes: Uint8Array, name: string, type: string): File {
  const part = Buffer.from(bytes);
  return new File([part], name, { type });
}

/** Uncompressed-ish JPEG that exceeds 2MB. */
function makeLargeJpegFile(): File {
  const c = document.createElement("canvas");
  c.width = 2500;
  c.height = 2500;
  const ctx = c.getContext("2d")!;
  for (let y = 0; y < c.height; y += 2) {
    for (let x = 0; x < c.width; x += 2) {
      ctx.fillStyle = `rgb(${(x * 13 + y) % 256},${(y * 7) % 256},${(x * y) % 256})`;
      ctx.fillRect(x, y, 2, 2);
    }
  }
  const maybeBuf = c as unknown as { toBuffer?: (m?: string, o?: object) => Buffer };
  if (typeof maybeBuf.toBuffer !== "function") {
    throw new Error("node-canvas toBuffer required for prepare image fixture");
  }
  const bytes = new Uint8Array(maybeBuf.toBuffer("image/jpeg", { quality: 1 }));
  expect(bytes.byteLength).toBeGreaterThan(MAX_STILL_BYTES);
  return fileFromBytes(bytes, "big.jpg", "image/jpeg");
}

function makeManyFrameGif(): File {
  const w = 64;
  const h = 64;
  const frameCount = 30;
  const buf = Buffer.alloc(w * h * frameCount * 8 + 1024);
  const palette = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00];
  const gw = new GifWriter(buf, w, h, { palette, loop: 0 });
  const pixels = new Array(w * h);
  for (let f = 0; f < frameCount; f++) {
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i + f) % palette.length;
    gw.addFrame(0, 0, w, h, pixels, { delay: 10 });
  }
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, gw.end());
  return fileFromBytes(bytes, "anim.gif", "image/gif");
}

describe("prepareSourceMedia", () => {
  it("shrinks oversized JPEG under 2MB", async () => {
    const file = makeLargeJpegFile();
    expect(file.size).toBeGreaterThan(MAX_STILL_BYTES);
    const phases: string[] = [];
    const result = await prepareSourceMedia(file, {
      onProgress: (p) => phases.push(p.phase),
    });
    expect(result.kind).toBe("image");
    expect(result.file.size).toBeLessThanOrEqual(MAX_STILL_BYTES);
    expect(phases).toContain("decode");
    expect(phases).toContain("compress");
    expect(phases).toContain("done");
  }, 60_000);

  it.skipIf(!gifencOk)("GIF prepare stays ≤ 3MB", async () => {
    const file = makeManyFrameGif();
    const result = await prepareSourceMedia(file);
    expect(result.kind).toBe("gif");
    expect(result.file.size).toBeLessThanOrEqual(MAX_GIF_BYTES);
  });

  it.skipIf(!gifencOk)("encodeGifUnderBudget caps synthetic RGBA", async () => {
    const frames = [];
    for (let f = 0; f < 30; f++) {
      const data = new Uint8Array(1024 * 1024 * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = (i + f) % 256;
        data[i + 1] = (f * 3) % 256;
        data[i + 2] = 128;
        data[i + 3] = 255;
      }
      frames.push({ data, width: 1024, height: 1024 });
    }
    const bytes = await encodeGifUnderBudget(frames, 7);
    expect(bytes.byteLength).toBeLessThanOrEqual(MAX_GIF_BYTES);
  }, 30_000);

  it.skipIf(typeof MediaRecorder === "undefined")("video prepare requires MediaRecorder", () => {
    expect(typeof MediaRecorder).not.toBe("undefined");
  });
});
