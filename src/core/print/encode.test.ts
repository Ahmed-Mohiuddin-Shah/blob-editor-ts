import { describe, expect, it } from "vitest";
import { encodePrint } from "./encode.js";
import { layoutGrid, pageA4 } from "./index.js";

/** Minimal valid 1×1 PNG. */
const TINY_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

describe("encodePrint PDF", () => {
  it("embeds source PNGs into a PDF", async () => {
    const doc = layoutGrid(["a", "b"], pageA4(), { rows: 1, columns: 2 });
    const result = await encodePrint(
      doc,
      async (id) => (id === "a" || id === "b" ? TINY_PNG : null),
      { formats: ["pdf"] },
    );
    expect(result.exports.pdf).toBeDefined();
    expect(result.exports.png).toBeUndefined();
    expect(result.exports.pdf!.byteLength).toBeGreaterThan(100);
    // PDF magic
    const head = String.fromCharCode(...result.exports.pdf!.slice(0, 5));
    expect(head).toBe("%PDF-");
    expect(result.meta.mimeTypes.pdf).toBe("application/pdf");
  });
});
