import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import {
  addPrintItem,
  createEmptyPrintDocument,
  layoutGrid,
  movePrintItem,
  pageA4,
  pageA5,
  pageCustom,
  removePrintItem,
  renderPrintPngBlob,
  resizePrintItem,
  rotatePrintItem,
  setPrintPage,
  validatePrintDocument,
  type PrintAssetMeta,
  type PrintDocument,
  type PrintExportPayload,
  type PrintPage,
} from "../core/print/index.js";
import {
  DEFAULT_THEME,
  themeStyle,
  resolveThemeMode,
  usePrefersDark,
  type ThemeMode,
} from "./theme.js";

export interface PrintLayoutProps {
  document?: PrintDocument | unknown;
  /** Sticker tray entries (ids must match resolveAsset). */
  assets: PrintAssetMeta[];
  resolveAsset: (assetId: string) => Promise<CanvasImageSource | null> | CanvasImageSource | null;
  primary?: string;
  onPrimary?: string;
  secondary?: string;
  onSecondary?: string;
  blocky?: boolean;
  themeMode?: ThemeMode;
  onExport: (payload: PrintExportPayload) => void;
  onCancel?: () => void;
}

type PrintSection = "stickers" | "layout" | "transform" | "page";

const SECTION_LABELS: Record<PrintSection, string> = {
  stickers: "Stickers",
  layout: "Layout",
  transform: "Transform",
  page: "Page",
};

type DragState =
  | { kind: "move"; id: string; ox: number; oy: number; startX: number; startY: number }
  | { kind: "resize"; id: string; startW: number; startX: number };

function pageAspect(page: PrintPage): number {
  return page.width_mm / page.height_mm;
}

export function PrintLayout({
  document: initialDoc,
  assets,
  resolveAsset,
  primary = DEFAULT_THEME.primary,
  onPrimary = DEFAULT_THEME.onPrimary,
  secondary = DEFAULT_THEME.secondary,
  onSecondary = DEFAULT_THEME.onSecondary,
  blocky = false,
  themeMode = "system",
  onExport,
  onCancel,
}: PrintLayoutProps) {
  const prefersDark = usePrefersDark();
  const resolved = resolveThemeMode(themeMode, prefersDark);
  const style = themeStyle(
    { primary, onPrimary, secondary, onSecondary, blocky, themeMode },
    resolved,
  );

  const [doc, setDoc] = useState<PrintDocument>(() => {
    if (initialDoc) {
      try {
        return validatePrintDocument(initialDoc);
      } catch {
        /* fall through */
      }
    }
    return createEmptyPrintDocument(pageA4());
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [section, setSection] = useState<PrintSection | null>("stickers");
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [bitmaps, setBitmaps] = useState<Record<string, CanvasImageSource>>({});
  const [busy, setBusy] = useState(false);
  const [gridRows, setGridRows] = useState(3);
  const [gridCols, setGridCols] = useState(3);
  const [preset, setPreset] = useState<"a4" | "a5" | "square">("a4");
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const nextThumbs: Record<string, string> = {};
      const nextBm: Record<string, CanvasImageSource> = {};
      for (const a of assets) {
        if (a.thumbUrl) nextThumbs[a.id] = a.thumbUrl;
        const img = await resolveAsset(a.id);
        if (cancelled || !img) continue;
        nextBm[a.id] = img;
        if (!a.thumbUrl && img instanceof HTMLImageElement) {
          nextThumbs[a.id] = img.src;
        } else if (!a.thumbUrl) {
          try {
            const c = document.createElement("canvas");
            c.width = 64;
            c.height = 64;
            c.getContext("2d")!.drawImage(img as CanvasImageSource, 0, 0, 64, 64);
            nextThumbs[a.id] = c.toDataURL("image/png");
          } catch {
            /* ignore */
          }
        }
      }
      if (!cancelled) {
        setThumbs((t) => ({ ...t, ...nextThumbs }));
        setBitmaps((b) => ({ ...b, ...nextBm }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assets, resolveAsset]);

  const resolver = useCallback((id: string) => bitmaps[id] ?? null, [bitmaps]);

  function mmPerPx(): number {
    const el = stageRef.current;
    if (!el) return doc.page.width_mm / 300;
    return doc.page.width_mm / Math.max(1, el.clientWidth);
  }

  const selected = selectedId ? doc.items.find((i) => i.id === selectedId) : undefined;

  function applyPreset(kind: "a4" | "a5" | "square") {
    const page =
      kind === "a4" ? pageA4() : kind === "a5" ? pageA5() : pageCustom(210, 210);
    setPreset(kind);
    setDoc((d) =>
      setPrintPage(d, { ...page, cut_marks: d.page.cut_marks, background: d.page.background }),
    );
  }

  function onAutoGrid() {
    const ids = assets.map((a) => a.id);
    if (!ids.length) return;
    setDoc(layoutGrid(ids, doc.page, { rows: gridRows, columns: gridCols, gap_mm: 2 }));
    setSelectedId(null);
  }

  function addAsset(assetId: string) {
    setDoc((d) => addPrintItem(d, { asset_id: assetId, width_mm: 40 }));
  }

  function selectSection(id: PrintSection) {
    setSection((cur) => (cur === id ? null : id));
  }

  function onPointerDownItem(e: ReactPointerEvent, id: string) {
    e.stopPropagation();
    e.preventDefault();
    const it = doc.items.find((i) => i.id === id);
    if (!it) return;
    setSelectedId(id);
    setSection((s) => s ?? "transform");
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      kind: "move",
      id,
      ox: it.x_mm,
      oy: it.y_mm,
      startX: e.clientX,
      startY: e.clientY,
    };
  }

  function onPointerDownResize(e: ReactPointerEvent, id: string) {
    e.stopPropagation();
    e.preventDefault();
    const it = doc.items.find((i) => i.id === id);
    if (!it) return;
    setSelectedId(id);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { kind: "resize", id, startW: it.width_mm, startX: e.clientX };
  }

  function onPointerMove(e: ReactPointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const scale = mmPerPx();
    if (drag.kind === "move") {
      const dx = (e.clientX - drag.startX) * scale;
      const dy = (e.clientY - drag.startY) * scale;
      setDoc((d) => movePrintItem(d, drag.id, drag.ox + dx, drag.oy + dy));
    } else {
      const dw = (e.clientX - drag.startX) * scale;
      setDoc((d) => resizePrintItem(d, drag.id, Math.max(8, drag.startW + dw)));
    }
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  async function doExport() {
    setBusy(true);
    try {
      const previewPng = await renderPrintPngBlob(doc, resolver, 96);
      onExport({ document: doc, previewPng });
    } finally {
      setBusy(false);
    }
  }

  const aspect = pageAspect(doc.page);
  const stageStyle: CSSProperties = {
    aspectRatio: `${aspect}`,
    ["--print-aspect" as string]: String(aspect),
    background:
      doc.page.background === "transparent"
        ? "repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50% / 16px 16px"
        : doc.page.background,
  };

  let panelBody: ReactNode = null;
  if (section === "stickers") {
    panelBody = (
      <div className="blob-print-hscroll" role="list">
        {assets.map((a) => (
          <button
            key={a.id}
            type="button"
            className="blob-print-tray-item"
            title={a.label ?? a.id}
            onClick={() => addAsset(a.id)}
          >
            {thumbs[a.id] ? (
              <img src={thumbs[a.id]} alt={a.label ?? a.id} />
            ) : (
              <span>{a.label ?? a.id}</span>
            )}
          </button>
        ))}
        {!assets.length && <span className="blob-muted">No stickers</span>}
      </div>
    );
  } else if (section === "layout") {
    panelBody = (
      <div className="blob-print-hscroll blob-print-controls-row">
        <label className="blob-print-chip-control">
          Rows
          <input
            type="number"
            min={1}
            max={8}
            value={gridRows}
            onChange={(e) => setGridRows(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        <label className="blob-print-chip-control">
          Cols
          <input
            type="number"
            min={1}
            max={8}
            value={gridCols}
            onChange={(e) => setGridCols(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        <button type="button" className="blob-btn blob-btn-primary" onClick={onAutoGrid}>
          Auto grid
        </button>
      </div>
    );
  } else if (section === "transform") {
    panelBody = selected ? (
      <div className="blob-print-hscroll blob-print-controls-row">
        <label className="blob-print-chip-control blob-print-range">
          Size
          <input
            type="range"
            min={8}
            max={Math.min(doc.page.width_mm, doc.page.height_mm)}
            value={selected.width_mm}
            onChange={(e) =>
              setDoc((d) => resizePrintItem(d, selected.id, Number(e.target.value)))
            }
          />
        </label>
        <label className="blob-print-chip-control blob-print-range">
          Rotate
          <input
            type="range"
            min={-180}
            max={180}
            value={selected.rotation_deg}
            onChange={(e) =>
              setDoc((d) => rotatePrintItem(d, selected.id, Number(e.target.value)))
            }
          />
        </label>
        <button
          type="button"
          className="blob-btn"
          onClick={() => {
            setDoc((d) => removePrintItem(d, selected.id));
            setSelectedId(null);
          }}
        >
          Remove
        </button>
      </div>
    ) : (
      <p className="blob-muted blob-print-panel-hint">Select a sticker on the page</p>
    );
  } else if (section === "page") {
    panelBody = (
      <div className="blob-print-hscroll blob-print-controls-row">
        <label className="blob-print-check blob-print-chip-control">
          <input
            type="checkbox"
            checked={doc.page.cut_marks}
            onChange={(e) =>
              setDoc((d) => setPrintPage(d, { ...d.page, cut_marks: e.target.checked }))
            }
          />
          Cut marks
        </label>
        <button
          type="button"
          className="blob-btn"
          onClick={() =>
            setDoc((d) =>
              setPrintPage(d, {
                ...d.page,
                background: d.page.background === "transparent" ? "#FFFFFF" : "transparent",
              }),
            )
          }
        >
          {doc.page.background === "transparent" ? "White BG" : "Clear BG"}
        </button>
      </div>
    );
  }

  return (
    <div className="blob-editor blob-print-layout" style={style as CSSProperties}>
      <header className="blob-print-topbar">
        {onCancel ? (
          <button
            type="button"
            className="blob-btn blob-print-back"
            onClick={onCancel}
            aria-label="Back"
          >
            ←
          </button>
        ) : (
          <span className="blob-print-back-spacer" />
        )}
        <div className="blob-print-presets" role="group" aria-label="Page size">
          {(["a4", "a5", "square"] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={`blob-print-preset${preset === k ? " is-active" : ""}`}
              onClick={() => applyPreset(k)}
            >
              {k === "square" ? "1:1" : k.toUpperCase()}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="blob-btn blob-btn-primary blob-print-export"
          disabled={busy}
          onClick={() => void doExport()}
        >
          Export
        </button>
      </header>

      <div className="blob-print-body">
        <div
          className="blob-print-stage-wrap"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={() => setSelectedId(null)}
        >
          <div ref={stageRef} className="blob-print-stage" style={stageStyle}>
            {doc.items.map((it) => {
              const thumb = thumbs[it.asset_id];
              const left = `${(it.x_mm / doc.page.width_mm) * 100}%`;
              const top = `${(it.y_mm / doc.page.height_mm) * 100}%`;
              const width = `${(it.width_mm / doc.page.width_mm) * 100}%`;
              const sel = it.id === selectedId;
              return (
                <div
                  key={it.id}
                  className={`blob-print-item${sel ? " is-selected" : ""}`}
                  style={{
                    left,
                    top,
                    width,
                    aspectRatio: "1",
                    transform: `rotate(${it.rotation_deg}deg)`,
                  }}
                  onPointerDown={(e) => onPointerDownItem(e, it.id)}
                  onClick={(e) => e.stopPropagation()}
                >
                  {thumb ? <img src={thumb} alt="" draggable={false} /> : null}
                  {sel && (
                    <button
                      type="button"
                      className="blob-print-resize"
                      aria-label="Resize"
                      onPointerDown={(e) => onPointerDownResize(e, it.id)}
                    />
                  )}
                </div>
              );
            })}
            {doc.page.cut_marks && <div className="blob-print-cutmarks" aria-hidden />}
          </div>
        </div>

        <div className="blob-print-chrome">
          <nav className="blob-tool-nav blob-print-section-nav" role="tablist" aria-label="Print tools">
            {(Object.keys(SECTION_LABELS) as PrintSection[]).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={section === id}
                className={`blob-tool-nav-item${section === id ? " is-active" : ""}`}
                onClick={() => selectSection(id)}
              >
                {SECTION_LABELS[id]}
              </button>
            ))}
          </nav>

          {section && (
            <div
              className="blob-tool-panel blob-print-panel"
              role="tabpanel"
              aria-label={SECTION_LABELS[section]}
            >
              <div className="blob-tool-panel-head">
                <span className="blob-inspector-title">{SECTION_LABELS[section]}</span>
                <button
                  type="button"
                  className="blob-btn blob-btn-ghost blob-tool-panel-close"
                  onClick={() => setSection(null)}
                  aria-label="Collapse panel"
                >
                  Close
                </button>
              </div>
              <div className="blob-tool-panel-body blob-print-panel-body">{panelBody}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
