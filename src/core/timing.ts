import type { TimeRange } from "./types.js";

export function rangeDurationMs(r: TimeRange): number {
  return Math.max(0, r.end_ms - r.start_ms);
}

/** Single-range trim duration. */
export function keepDurationMs(keep: TimeRange | null | undefined): number {
  if (!keep) return 0;
  return rangeDurationMs(keep);
}

/** @deprecated alias — prefer keepDurationMs */
export function keepTotalMs(keep: TimeRange | TimeRange[] | null | undefined): number {
  if (!keep) return 0;
  if (Array.isArray(keep)) {
    return keep.reduce((s, r) => s + rangeDurationMs(r), 0);
  }
  return rangeDurationMs(keep);
}

/** Map composition-local t through single source trim → source ms. null if past end. */
export function mapCompToSource(keep: TimeRange | null | undefined, tMs: number): number | null {
  if (!keep) return tMs;
  const d = rangeDurationMs(keep);
  if (tMs < 0 || tMs >= d) return null;
  return keep.start_ms + tMs;
}

/** Collapse legacy multi-range keep / raw unknown → single TimeRange | null. */
export function coerceKeep(raw: unknown): TimeRange | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    if (!raw.length) return null;
    const first = raw[0];
    if (!first || typeof first !== "object") return null;
    const r = first as Record<string, unknown>;
    if (typeof r.start_ms !== "number" || typeof r.end_ms !== "number") return null;
    if (r.end_ms <= r.start_ms) return null;
    return { start_ms: r.start_ms, end_ms: r.end_ms };
  }
  if (typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (typeof r.start_ms !== "number" || typeof r.end_ms !== "number") return null;
    if (r.end_ms <= r.start_ms) return null;
    return { start_ms: r.start_ms, end_ms: r.end_ms };
  }
  return null;
}
