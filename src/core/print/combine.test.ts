import { describe, expect, it } from "vitest";
import { combinePdfs, combinePngsGrid, evenGridDims } from "./combine.js";
import { encodePrint } from "./encode.js";
import { layoutGrid, pageA4 } from "./index.js";

const TINY_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

describe("evenGridDims", () => {
  it("picks near-square grids", () => {
    expect(evenGridDims(1)).toEqual({ rows: 1, columns: 1 });
    expect(evenGridDims(4)).toEqual({ rows: 2, columns: 2 });
    expect(evenGridDims(5)).toEqual({ rows: 2, columns: 3 });
    expect(evenGridDims(7)).toEqual({ rows: 3, columns: 3 });
    expect(evenGridDims(9)).toEqual({ rows: 3, columns: 3 });
  });
});

describe("combinePdfs", () => {
  it("appends pages from multiple single-page PDFs", async () => {
    const doc = layoutGrid(["a"], pageA4(), { rows: 1, columns: 1 });
    const a = await encodePrint(doc, async () => TINY_PNG, { formats: ["pdf"] });
    const b = await encodePrint(doc, async () => TINY_PNG, { formats: ["pdf"] });
    const merged = await combinePdfs([a.exports.pdf!, b.exports.pdf!]);
    expect(String.fromCharCode(...merged.slice(0, 5))).toBe("%PDF-");

    const PDFLib = await import("pdf-lib");
    const loaded = await PDFLib.PDFDocument.load(merged);
    expect(loaded.getPageCount()).toBe(2);
  });
});

describe("combinePngsGrid", () => {
  it("builds a grid PNG from several sheets", async () => {
    // Skip if no canvas / ImageBitmap (plain Node without OffscreenCanvas)
    if (typeof createImageBitmap !== "function" && typeof OffscreenCanvas === "undefined") {
      return;
    }
    const out = await combinePngsGrid([TINY_PNG, TINY_PNG, TINY_PNG], {
      cellPx: 32,
      gapPx: 4,
    });
    expect(out.byteLength).toBeGreaterThan(50);
    // PNG magic
    expect(out[0]).toBe(0x89);
    expect(out[1]).toBe(0x50);
  });
});
