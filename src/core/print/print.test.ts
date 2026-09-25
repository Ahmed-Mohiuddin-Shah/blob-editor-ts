import { describe, expect, it } from "vitest";
import {
  PRINT_DOCUMENT_VERSION,
  addPrintItem,
  createEmptyPrintDocument,
  layoutGrid,
  movePrintItem,
  pageA4,
  pageA5,
  pageCustom,
  removePrintItem,
  resizePrintItem,
  rotatePrintItem,
  setPrintPage,
  updatePrintItem,
  validatePrintDocument,
  PrintValidationError,
  mmToPx,
  mmToPt,
  pagePixelSize,
} from "./index.js";

describe("validatePrintDocument", () => {
  it("accepts empty A4 doc", () => {
    const doc = createEmptyPrintDocument();
    expect(validatePrintDocument(doc)).toEqual(doc);
    expect(doc.version).toBe(PRINT_DOCUMENT_VERSION);
    expect(doc.page.width_mm).toBe(210);
  });

  it("rejects bad page size", () => {
    expect(() =>
      validatePrintDocument({
        version: 1,
        page: {
          width_mm: 0,
          height_mm: 297,
          margin_mm: { top: 10, right: 10, bottom: 10, left: 10 },
          background: "#FFFFFF",
          cut_marks: true,
        },
        items: [],
      }),
    ).toThrow(PrintValidationError);
  });

  it("rejects bad background", () => {
    expect(() =>
      validatePrintDocument({
        version: 1,
        page: {
          width_mm: 210,
          height_mm: 297,
          margin_mm: { top: 10, right: 10, bottom: 10, left: 10 },
          background: "white",
          cut_marks: true,
        },
        items: [],
      }),
    ).toThrow(/background/);
  });

  it("rejects duplicate item ids", () => {
    expect(() =>
      validatePrintDocument({
        version: 1,
        page: pageA4(),
        items: [
          { id: "a", asset_id: "s1", x_mm: 0, y_mm: 0, width_mm: 40, rotation_deg: 0 },
          { id: "a", asset_id: "s2", x_mm: 50, y_mm: 0, width_mm: 40, rotation_deg: 0 },
        ],
      }),
    ).toThrow(/duplicate/);
  });
});

describe("print ops", () => {
  it("add / move / resize / rotate / remove", () => {
    let doc = createEmptyPrintDocument(pageA5());
    doc = addPrintItem(doc, { asset_id: "sticker_1", width_mm: 30 });
    expect(doc.items).toHaveLength(1);
    const id = doc.items[0]!.id;
    doc = movePrintItem(doc, id, 20, 30);
    doc = resizePrintItem(doc, id, 50);
    doc = rotatePrintItem(doc, id, 15);
    expect(doc.items[0]).toMatchObject({
      x_mm: 20,
      y_mm: 30,
      width_mm: 50,
      rotation_deg: 15,
    });
    doc = removePrintItem(doc, id);
    expect(doc.items).toHaveLength(0);
  });

  it("setPrintPage swaps preset", () => {
    let doc = createEmptyPrintDocument(pageA4());
    doc = setPrintPage(doc, pageCustom(100, 100, { cut_marks: false }));
    expect(doc.page.width_mm).toBe(100);
    expect(doc.page.cut_marks).toBe(false);
  });

  it("updatePrintItem rejects non-positive width", () => {
    let doc = createEmptyPrintDocument();
    doc = addPrintItem(doc, { asset_id: "a" });
    expect(() => updatePrintItem(doc, doc.items[0]!.id, { width_mm: 0 })).toThrow(/width_mm/);
  });
});

describe("layoutGrid", () => {
  it("fills 2x3 grid with square cells inside margins", () => {
    const page = pageA4();
    const doc = layoutGrid(["a", "b", "c", "d", "e", "f"], page, {
      rows: 2,
      columns: 3,
      gap_mm: 2,
    });
    expect(doc.items).toHaveLength(6);
    const m = page.margin_mm;
    for (const it of doc.items) {
      expect(it.x_mm).toBeGreaterThanOrEqual(m.left - 0.01);
      expect(it.y_mm).toBeGreaterThanOrEqual(m.top - 0.01);
      expect(it.width_mm).toBeGreaterThan(0);
      expect(it.rotation_deg).toBe(0);
    }
    // All stickers same size
    const w = doc.items[0]!.width_mm;
    expect(doc.items.every((it) => it.width_mm === w)).toBe(true);
  });

  it("drops ids beyond capacity", () => {
    const doc = layoutGrid(["1", "2", "3", "4", "5"], pageA4(), { rows: 2, columns: 2 });
    expect(doc.items).toHaveLength(4);
  });
});

describe("units", () => {
  it("mmToPx / mmToPt / pagePixelSize", () => {
    expect(mmToPx(25.4, 100)).toBeCloseTo(100);
    expect(mmToPt(25.4)).toBeCloseTo(72);
    const sz = pagePixelSize(pageA4(), 72);
    expect(sz.width).toBe(Math.round(mmToPx(210, 72)));
    expect(sz.height).toBe(Math.round(mmToPx(297, 72)));
  });
});
