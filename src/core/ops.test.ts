import { describe, expect, it } from "vitest";
import {
  addText,
  applyMask,
  createEmptyDocument,
  createFromSource,
  remixDeepCopy,
  setBackground,
  updateTransform,
  validateDocument,
  DocumentValidationError,
  EXPORT_SIZES,
  CANVAS_SIZE,
} from "./index.js";

describe("validateDocument", () => {
  it("accepts a minimal valid doc", () => {
    const doc = createEmptyDocument();
    expect(validateDocument(doc)).toEqual(doc);
  });

  it("rejects wrong canvas size", () => {
    expect(() =>
      validateDocument({
        version: 1,
        canvas: { width: 100, height: 100, background: "transparent" },
        objects: [],
      }),
    ).toThrow(DocumentValidationError);
  });

  it("rejects bad background", () => {
    expect(() =>
      validateDocument({
        version: 1,
        canvas: { width: 1024, height: 1024, background: "red" },
        objects: [],
      }),
    ).toThrow(/background/);
  });
});

describe("ops", () => {
  it("createFromSource centers and scales to fit", () => {
    const doc = createFromSource("a1", 1920, 1080);
    expect(doc.objects).toHaveLength(1);
    const m = doc.objects[0];
    expect(m.type).toBe("media");
    if (m.type !== "media") return;
    expect(m.transform.x).toBe(CANVAS_SIZE / 2);
    expect(m.transform.scale_x).toBeCloseTo(1024 / 1920);
  });

  it("updateTransform / setBackground / addText / applyMask", () => {
    let doc = createFromSource("a1", 100, 100);
    const id = doc.objects[0].id;
    doc = updateTransform(doc, id, { rotation: 45 });
    doc = setBackground(doc, "#ff00aa");
    doc = applyMask(doc, id, "mask1");
    doc = addText(doc, { text: "HI" });
    expect(doc.canvas.background).toBe("#ff00aa");
    expect(doc.objects).toHaveLength(2);
    const media = doc.objects[0];
    expect(media.type).toBe("media");
    if (media.type === "media") {
      expect(media.transform.rotation).toBe(45);
      expect(media.mask_asset_id).toBe("mask1");
    }
  });
});

describe("remixDeepCopy", () => {
  it("deep-copies and keeps asset ids", () => {
    const src = createFromSource("shared", 50, 50);
    const copy = remixDeepCopy(src);
    expect(copy).toEqual(src);
    expect(copy).not.toBe(src);
    expect(copy.objects).not.toBe(src.objects);
    if (copy.objects[0].type === "media" && src.objects[0].type === "media") {
      expect(copy.objects[0].asset_id).toBe("shared");
    }
  });
});

describe("EXPORT_SIZES", () => {
  it("locks chat/thumbnail/full", () => {
    expect(EXPORT_SIZES).toEqual({ chat: 128, thumbnail: 256, full: 1024 });
  });
});
