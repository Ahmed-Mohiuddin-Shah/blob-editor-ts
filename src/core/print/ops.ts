import { createEmptyPrintDocument } from "./presets.js";
import type {
  LayoutGridOptions,
  PrintDocument,
  PrintItem,
  PrintPage,
} from "./types.js";

let _seq = 0;
export function newPrintItemId(prefix = "item"): string {
  _seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${_seq}`;
}

function mapItem(
  doc: PrintDocument,
  id: string,
  fn: (item: PrintItem) => PrintItem,
): PrintDocument {
  let found = false;
  const items = doc.items.map((it) => {
    if (it.id !== id) return it;
    found = true;
    return fn(it);
  });
  if (!found) throw new Error(`print item not found: ${id}`);
  return { ...doc, items };
}

export function setPrintPage(doc: PrintDocument, page: PrintPage): PrintDocument {
  return { ...doc, page };
}

export function addPrintItem(
  doc: PrintDocument,
  partial: {
    asset_id: string;
    x_mm?: number;
    y_mm?: number;
    width_mm?: number;
    rotation_deg?: number;
    id?: string;
  },
): PrintDocument {
  const m = doc.page.margin_mm;
  const item: PrintItem = {
    id: partial.id ?? newPrintItemId(),
    asset_id: partial.asset_id,
    x_mm: partial.x_mm ?? m.left,
    y_mm: partial.y_mm ?? m.top,
    width_mm: partial.width_mm ?? 40,
    rotation_deg: partial.rotation_deg ?? 0,
  };
  return { ...doc, items: [...doc.items, item] };
}

export function removePrintItem(doc: PrintDocument, id: string): PrintDocument {
  const items = doc.items.filter((it) => it.id !== id);
  if (items.length === doc.items.length) throw new Error(`print item not found: ${id}`);
  return { ...doc, items };
}

export function updatePrintItem(
  doc: PrintDocument,
  id: string,
  patch: Partial<Omit<PrintItem, "id">>,
): PrintDocument {
  return mapItem(doc, id, (it) => {
    const next = { ...it, ...patch, id: it.id };
    if (next.width_mm <= 0) throw new Error("width_mm must be > 0");
    return next;
  });
}

export function movePrintItem(
  doc: PrintDocument,
  id: string,
  x_mm: number,
  y_mm: number,
): PrintDocument {
  return updatePrintItem(doc, id, { x_mm, y_mm });
}

export function resizePrintItem(doc: PrintDocument, id: string, width_mm: number): PrintDocument {
  return updatePrintItem(doc, id, { width_mm });
}

export function rotatePrintItem(
  doc: PrintDocument,
  id: string,
  rotation_deg: number,
): PrintDocument {
  return updatePrintItem(doc, id, { rotation_deg });
}

export function reorderPrintItem(
  doc: PrintDocument,
  id: string,
  toIndex: number,
): PrintDocument {
  const from = doc.items.findIndex((it) => it.id === id);
  if (from < 0) throw new Error(`print item not found: ${id}`);
  const items = [...doc.items];
  const [it] = items.splice(from, 1);
  const idx = Math.max(0, Math.min(items.length, toIndex));
  items.splice(idx, 0, it!);
  return { ...doc, items };
}

/**
 * Pack asset ids into a grid inside page margins.
 * Cell size = min(cellW, cellH); stickers stay square.
 * Extra ids beyond rows×cols are dropped (ponytail: caller paginates).
 */
export function layoutGrid(
  assetIds: string[],
  page: PrintPage,
  opts: LayoutGridOptions,
): PrintDocument {
  const rows = Math.max(1, Math.floor(opts.rows));
  const cols = Math.max(1, Math.floor(opts.columns));
  const gap = opts.gap_mm ?? 2;
  const m = page.margin_mm;
  const innerW = page.width_mm - m.left - m.right;
  const innerH = page.height_mm - m.top - m.bottom;
  if (innerW <= 0 || innerH <= 0) {
    throw new Error("page margins leave no printable area");
  }
  const cellW = (innerW - gap * (cols - 1)) / cols;
  const cellH = (innerH - gap * (rows - 1)) / rows;
  if (cellW <= 0 || cellH <= 0) {
    throw new Error("grid cells have non-positive size");
  }
  const sticker = Math.min(cellW, cellH);
  const capacity = rows * cols;
  const ids = assetIds.slice(0, capacity);
  const items: PrintItem[] = ids.map((asset_id, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x_mm = m.left + c * (cellW + gap) + (cellW - sticker) / 2;
    const y_mm = m.top + r * (cellH + gap) + (cellH - sticker) / 2;
    return {
      id: newPrintItemId("grid"),
      asset_id,
      x_mm,
      y_mm,
      width_mm: sticker,
      rotation_deg: 0,
    };
  });
  return { ...createEmptyPrintDocument(page), items };
}

export function findPrintItem(doc: PrintDocument, id: string): PrintItem | undefined {
  return doc.items.find((it) => it.id === id);
}
