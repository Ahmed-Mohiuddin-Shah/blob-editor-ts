import { describe, expect, it } from "vitest";
import {
  addMedia,
  addText,
  applyMask,
  createEmptyDocument,
  createFromSource,
  remixDeepCopy,
  setBackground,
  setKeep,
  setMuteSource,
  setOutline,
  setTrim,
  syncDurationFromPrimary,
  updateTransform,
  validateDocument,
  migrateDocument,
  DocumentValidationError,
  EXPORT_SIZES,
  CANVAS_SIZE,
  DOCUMENT_VERSION,
  keepDurationMs,
  keepTotalMs,
  mapCompToSource,
  coerceKeep,
} from "./index.js";

describe("validateDocument", () => {
  it("accepts a minimal valid doc", () => {
    const doc = createEmptyDocument();
    expect(validateDocument(doc)).toEqual(doc);
    expect(doc.version).toBe(DOCUMENT_VERSION);
  });

  it("migrates v1", () => {
    const v1 = {
      version: 1,
      canvas: { width: 1024, height: 1024, background: "transparent" },
      objects: [],
    };
    const doc = validateDocument(v1);
    expect(doc.version).toBe(2);
    expect(doc.duration_ms).toBe(0);
    expect(doc.audio).toBeNull();
  });

  it("rejects wrong canvas size", () => {
    expect(() =>
      validateDocument({
        version: 2,
        canvas: { width: 100, height: 100, background: "transparent" },
        objects: [],
        duration_ms: 0,
        fps: 15,
        audio: null,
      }),
    ).toThrow(DocumentValidationError);
  });

  it("rejects bad background", () => {
    expect(() =>
      validateDocument({
        version: 2,
        canvas: { width: 1024, height: 1024, background: "red" },
        objects: [],
        duration_ms: 0,
        fps: 15,
        audio: null,
      }),
    ).toThrow(/background/);
  });

  it("rejects transparent bg on video", () => {
    const doc = createFromSource("v1", 100, 100, "#000000", {
      kind: "video",
      durationMs: 2000,
    });
    const raw = {
      ...doc,
      canvas: { ...doc.canvas, background: "transparent" },
    };
    expect(() => validateDocument(raw)).toThrow(/transparent/);
  });

  it("rejects multi-video / video overlays", () => {
    const base = createFromSource("v1", 100, 100, "#000000", {
      kind: "video",
      durationMs: 2000,
    });
    const raw = {
      ...base,
      objects: [
        ...base.objects,
        {
          id: "m2",
          type: "media",
          asset_id: "a2",
          kind: "image",
          transform: { x: 0, y: 0, scale_x: 1, scale_y: 1, rotation: 0 },
          crop: null,
          mask_asset_id: null,
          keep: null,
          outline: null,
        },
      ],
    };
    expect(() => validateDocument(raw)).toThrow(/overlays/);
  });

  it("rejects mask on gif", () => {
    const doc = createFromSource("g1", 100, 100, "transparent", {
      kind: "gif",
      durationMs: 2000,
    });
    const m = doc.objects[0];
    if (m.type !== "media") return;
    expect(() =>
      validateDocument({
        ...doc,
        objects: [{ ...m, mask_asset_id: "mask1" }],
      }),
    ).toThrow(/mask_asset_id/);
  });

  it("rejects duration over max", () => {
    expect(() =>
      validateDocument({
        version: 2,
        canvas: { width: 1024, height: 1024, background: "transparent" },
        objects: [],
        duration_ms: 20_000,
        fps: 15,
        audio: null,
      }),
    ).toThrow(/duration_ms/);
  });

  it("rejects trim start >= end", () => {
    const doc = createFromSource("g1", 100, 100, "transparent", {
      kind: "gif",
      durationMs: 2000,
    });
    const m = doc.objects[0];
    if (m.type !== "media") return;
    expect(() =>
      validateDocument({
        ...doc,
        objects: [{ ...m, keep: { start_ms: 500, end_ms: 500 } }],
      }),
    ).toThrow(/keep/);
  });
});

describe("timing", () => {
  it("maps single-range keep", () => {
    const keep = { start_ms: 1000, end_ms: 3000 };
    expect(keepDurationMs(keep)).toBe(2000);
    expect(mapCompToSource(keep, 0)).toBe(1000);
    expect(mapCompToSource(keep, 500)).toBe(1500);
    expect(mapCompToSource(keep, 2000)).toBeNull();
    expect(coerceKeep([{ start_ms: 0, end_ms: 100 }, { start_ms: 200, end_ms: 300 }])).toEqual({
      start_ms: 0,
      end_ms: 100,
    });
    expect(keepTotalMs(keep)).toBe(2000);
  });
});

describe("ops", () => {
  it("createFromSource centers and scales to fit", () => {
    const doc = createFromSource("a1", 1920, 1080);
    expect(doc.objects).toHaveLength(1);
    const m = doc.objects[0];
    expect(m.type).toBe("media");
    if (m.type !== "media") return;
    expect(m.kind).toBe("image");
    expect(m.transform.x).toBe(CANVAS_SIZE / 2);
    expect(m.transform.scale_x).toBeCloseTo(1024 / 1920);
  });

  it("createFromSource video sets duration/keep and opaque bg", () => {
    const doc = createFromSource("v1", 100, 100, "transparent", {
      kind: "video",
      durationMs: 5000,
    });
    expect(doc.duration_ms).toBe(5000);
    expect(doc.canvas.background).toBe("#000000");
    expect(doc.audio?.mute_source).toBe(true);
    const m = doc.objects[0];
    if (m.type === "media") {
      expect(m.kind).toBe("video");
      expect(m.keep).toEqual({ start_ms: 0, end_ms: 5000 });
    }
  });

  it("updateTransform / setBackground / addText / applyMask / outline", () => {
    let doc = createFromSource("a1", 100, 100);
    const id = doc.objects[0].id;
    doc = updateTransform(doc, id, { rotation: 45 });
    doc = setBackground(doc, "#ff00aa");
    doc = applyMask(doc, id, "mask1");
    doc = setOutline(doc, id, { color: "#ffffff", width: 8 });
    doc = addText(doc, { text: "HI" });
    expect(doc.canvas.background).toBe("#ff00aa");
    expect(doc.objects).toHaveLength(2);
    const media = doc.objects[0];
    expect(media.type).toBe("media");
    if (media.type === "media") {
      expect(media.transform.rotation).toBe(45);
      expect(media.mask_asset_id).toBe("mask1");
      expect(media.outline?.width).toBe(8);
    }
  });

  it("setTrim syncs duration", () => {
    let doc = createFromSource("g1", 100, 100, "transparent", {
      kind: "gif",
      durationMs: 4000,
    });
    const id = doc.objects[0].id;
    doc = setTrim(doc, id, 500, 2500);
    doc = syncDurationFromPrimary(doc);
    expect(doc.duration_ms).toBe(2000);
  });

  it("rejects video overlay and mask on gif", () => {
    const img = createFromSource("a1", 100, 100);
    expect(() =>
      addMedia(img, {
        asset_id: "v",
        kind: "video",
        naturalWidth: 50,
        naturalHeight: 50,
      }),
    ).toThrow(/overlay/);

    const gif = createFromSource("g1", 100, 100, "transparent", {
      kind: "gif",
      durationMs: 1000,
    });
    expect(() => applyMask(gif, gif.objects[0].id, "m")).toThrow(/image/);
  });

  it("setMuteSource on video only", () => {
    const vid = createFromSource("v1", 100, 100, "#000000", {
      kind: "video",
      durationMs: 1000,
    });
    const muted = setMuteSource(vid, false);
    expect(muted.audio?.mute_source).toBe(false);
    const img = createFromSource("a1", 100, 100);
    expect(() => setMuteSource(img, true)).toThrow(/video/);
  });

  it("setKeep collapses to single range via setTrim path", () => {
    let doc = createFromSource("g1", 100, 100, "transparent", {
      kind: "gif",
      durationMs: 4000,
    });
    const id = doc.objects[0].id;
    doc = setKeep(doc, id, { start_ms: 0, end_ms: 1000 });
    doc = syncDurationFromPrimary(doc);
    expect(doc.duration_ms).toBe(1000);
  });
});

describe("migrateDocument", () => {
  it("maps v1 timing to single keep and strips chroma/soundtrack", () => {
    const raw = {
      version: 1,
      canvas: { width: 1024, height: 1024, background: "transparent" },
      objects: [
        {
          id: "m1",
          type: "media",
          asset_id: "a",
          kind: "image",
          transform: { x: 0, y: 0, scale_x: 1, scale_y: 1, rotation: 0 },
          crop: null,
          mask_asset_id: null,
          timing: { start: 0, end: 2 },
          chroma: { color: "#00ff00", tolerance: 40 },
        },
        {
          id: "t1",
          type: "text",
          text: "HI",
          font: "Anton",
          font_size: 48,
          transform: { x: 0, y: 0, scale_x: 1, scale_y: 1, rotation: 0 },
          style: { fill: "#fff", stroke: "#000", stroke_width: 2 },
          keep: [{ start_ms: 0, end_ms: 1000 }],
        },
      ],
      audio: {
        mute_source: true,
        soundtrack_asset_id: "x",
        keep: null,
        gain: 0.5,
      },
    };
    const doc = migrateDocument(raw);
    expect(doc.version).toBe(2);
    const m = doc.objects[0];
    if (m.type === "media") {
      expect(m.keep).toEqual({ start_ms: 0, end_ms: 2000 });
      expect((m as { chroma?: unknown }).chroma).toBeUndefined();
    }
    const t = doc.objects[1];
    if (t.type === "text") {
      expect((t as { keep?: unknown }).keep).toBeUndefined();
    }
    // image primary → audio stripped
    expect(doc.audio).toBeNull();
  });

  it("collapses multi-range keep on v2 normalize", () => {
    const raw = {
      version: 2,
      canvas: { width: 1024, height: 1024, background: "transparent" },
      objects: [
        {
          id: "m1",
          type: "media",
          asset_id: "a",
          kind: "gif",
          transform: { x: 0, y: 0, scale_x: 1, scale_y: 1, rotation: 0 },
          crop: null,
          mask_asset_id: null,
          keep: [
            { start_ms: 0, end_ms: 500 },
            { start_ms: 1000, end_ms: 1500 },
          ],
          outline: null,
        },
      ],
      duration_ms: 1000,
      fps: 15,
      audio: null,
    };
    const doc = migrateDocument(raw);
    const m = doc.objects[0];
    if (m.type === "media") {
      expect(m.keep).toEqual({ start_ms: 0, end_ms: 500 });
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
