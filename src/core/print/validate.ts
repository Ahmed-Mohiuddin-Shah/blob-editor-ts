import {
  PRINT_DOCUMENT_VERSION,
  type PrintBackground,
  type PrintDocument,
  type PrintItem,
  type PrintMargins,
  type PrintPage,
} from "./types.js";

export class PrintValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrintValidationError";
  }
}

function isHexColor(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
}

function isBackground(v: unknown): v is PrintBackground {
  return v === "transparent" || isHexColor(v);
}

function validateMargins(v: unknown, path: string): PrintMargins {
  if (!v || typeof v !== "object") {
    throw new PrintValidationError(`${path} required`);
  }
  const m = v as Record<string, unknown>;
  for (const k of ["top", "right", "bottom", "left"] as const) {
    if (typeof m[k] !== "number" || !Number.isFinite(m[k]) || (m[k] as number) < 0) {
      throw new PrintValidationError(`${path}.${k} must be >= 0`);
    }
  }
  return {
    top: m.top as number,
    right: m.right as number,
    bottom: m.bottom as number,
    left: m.left as number,
  };
}

function validatePage(v: unknown): PrintPage {
  if (!v || typeof v !== "object") {
    throw new PrintValidationError("page required");
  }
  const p = v as Record<string, unknown>;
  if (typeof p.width_mm !== "number" || !(p.width_mm > 0)) {
    throw new PrintValidationError("page.width_mm must be > 0");
  }
  if (typeof p.height_mm !== "number" || !(p.height_mm > 0)) {
    throw new PrintValidationError("page.height_mm must be > 0");
  }
  if (!isBackground(p.background)) {
    throw new PrintValidationError("page.background must be transparent or #RRGGBB");
  }
  if (typeof p.cut_marks !== "boolean") {
    throw new PrintValidationError("page.cut_marks must be boolean");
  }
  return {
    width_mm: p.width_mm,
    height_mm: p.height_mm,
    margin_mm: validateMargins(p.margin_mm, "page.margin_mm"),
    background: p.background,
    cut_marks: p.cut_marks,
  };
}

function validateItem(v: unknown, index: number): PrintItem {
  if (!v || typeof v !== "object") {
    throw new PrintValidationError(`items[${index}] required`);
  }
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id) {
    throw new PrintValidationError(`items[${index}].id required`);
  }
  if (typeof o.asset_id !== "string" || !o.asset_id) {
    throw new PrintValidationError(`items[${index}].asset_id required`);
  }
  for (const k of ["x_mm", "y_mm", "width_mm", "rotation_deg"] as const) {
    if (typeof o[k] !== "number" || !Number.isFinite(o[k])) {
      throw new PrintValidationError(`items[${index}].${k} must be a number`);
    }
  }
  if ((o.width_mm as number) <= 0) {
    throw new PrintValidationError(`items[${index}].width_mm must be > 0`);
  }
  return {
    id: o.id,
    asset_id: o.asset_id,
    x_mm: o.x_mm as number,
    y_mm: o.y_mm as number,
    width_mm: o.width_mm as number,
    rotation_deg: o.rotation_deg as number,
  };
}

/** Accepts v1 PrintDocument JSON. Unknown versions rejected. */
export function validatePrintDocument(raw: unknown): PrintDocument {
  if (!raw || typeof raw !== "object") {
    throw new PrintValidationError("document must be an object");
  }
  const d = raw as Record<string, unknown>;
  const version = d.version;
  if (version !== PRINT_DOCUMENT_VERSION && version !== 1) {
    throw new PrintValidationError(`unsupported print document version: ${String(version)}`);
  }
  if (!Array.isArray(d.items)) {
    throw new PrintValidationError("items must be an array");
  }
  const items = d.items.map((it, i) => validateItem(it, i));
  const ids = new Set<string>();
  for (const it of items) {
    if (ids.has(it.id)) throw new PrintValidationError(`duplicate item id: ${it.id}`);
    ids.add(it.id);
  }
  return {
    version: PRINT_DOCUMENT_VERSION,
    page: validatePage(d.page),
    items,
  };
}
