import type { PrintDocument, PrintMargins, PrintPage } from "./types.js";
import { PRINT_DOCUMENT_VERSION } from "./types.js";

const DEFAULT_MARGINS: PrintMargins = { top: 10, right: 10, bottom: 10, left: 10 };

export function pageCustom(
  widthMm: number,
  heightMm: number,
  opts?: Partial<Omit<PrintPage, "width_mm" | "height_mm">>,
): PrintPage {
  return {
    width_mm: widthMm,
    height_mm: heightMm,
    margin_mm: opts?.margin_mm ?? { ...DEFAULT_MARGINS },
    background: opts?.background ?? "#FFFFFF",
    cut_marks: opts?.cut_marks ?? true,
  };
}

/** ISO A4 portrait 210×297 mm. */
export function pageA4(opts?: Partial<Omit<PrintPage, "width_mm" | "height_mm">>): PrintPage {
  return pageCustom(210, 297, opts);
}

/** ISO A5 portrait 148×210 mm. */
export function pageA5(opts?: Partial<Omit<PrintPage, "width_mm" | "height_mm">>): PrintPage {
  return pageCustom(148, 210, opts);
}

export const PAGE_PRESETS = {
  a4: pageA4,
  a5: pageA5,
  custom: pageCustom,
} as const;

export function createEmptyPrintDocument(page: PrintPage = pageA4()): PrintDocument {
  return {
    version: PRINT_DOCUMENT_VERSION,
    page,
    items: [],
  };
}

/** mm → CSS/canvas pixels at dpi. */
export function mmToPx(mm: number, dpi: number): number {
  return (mm / 25.4) * dpi;
}

/** mm → PDF points (1 pt = 1/72 in). */
export function mmToPt(mm: number): number {
  return (mm / 25.4) * 72;
}

export function pagePixelSize(page: PrintPage, dpi: number): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(mmToPx(page.width_mm, dpi))),
    height: Math.max(1, Math.round(mmToPx(page.height_mm, dpi))),
  };
}
