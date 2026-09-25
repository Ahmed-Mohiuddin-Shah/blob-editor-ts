import type { MediaObject } from "../core/types.js";
import type { MaskToolMode } from "./EditorStage.js";

export interface CutoutInspectorProps {
  obj: MediaObject;
  maskMode: MaskToolMode;
  brushSize: number;
  onBrushSize: (size: number) => void;
  onOutline: (outline: MediaObject["outline"]) => void;
  onMaskMode: (mode: MaskToolMode) => void;
  onClearMask: () => void;
  onApplyMask: () => void;
  onCommit: () => void;
}

/** Image-only: brush / polygon mask + white outline. */
export function CutoutInspector({
  obj,
  maskMode,
  brushSize,
  onBrushSize,
  onOutline,
  onMaskMode,
  onClearMask,
  onApplyMask,
  onCommit,
}: CutoutInspectorProps) {
  if (obj.kind !== "image") return null;
  const outline = obj.outline;
  const brushing = maskMode === "add" || maskMode === "remove";

  const endProps = {
    onPointerUp: onCommit,
    onMouseUp: onCommit,
    onTouchEnd: onCommit,
  };

  return (
    <div className="blob-inspector" role="group" aria-label="Cutout">
      <div className="blob-inspector-title">Cutout</div>
      <label className="blob-field blob-field-row">
        <input
          type="checkbox"
          checked={!!outline}
          onChange={(e) => {
            onOutline(e.target.checked ? { color: "#ffffff", width: 8 } : null);
            onCommit();
          }}
        />
        White sticker border
      </label>
      {outline && (
        <label className="blob-field blob-text-size">
          <span>Border width {outline.width}</span>
          <input
            type="range"
            min={2}
            max={32}
            value={outline.width}
            onChange={(e) => onOutline({ ...outline, width: Number(e.target.value) })}
            {...endProps}
          />
        </label>
      )}
      <div className="blob-timeline-actions">
        <button
          type="button"
          className={`blob-btn${maskMode === "add" ? " blob-btn-primary" : ""}`}
          style={{ minHeight: 44 }}
          onClick={() => onMaskMode(maskMode === "add" ? null : "add")}
        >
          Brush add
        </button>
        <button
          type="button"
          className={`blob-btn${maskMode === "remove" ? " blob-btn-primary" : ""}`}
          style={{ minHeight: 44 }}
          onClick={() => onMaskMode(maskMode === "remove" ? null : "remove")}
        >
          Brush remove
        </button>
        <button
          type="button"
          className={`blob-btn${maskMode === "polygon" ? " blob-btn-primary" : ""}`}
          style={{ minHeight: 44 }}
          onClick={() => onMaskMode(maskMode === "polygon" ? null : "polygon")}
        >
          Polygon
        </button>
      </div>
      {brushing && (
        <label className="blob-field blob-text-size">
          <span>Brush size {brushSize}</span>
          <input
            type="range"
            min={8}
            max={64}
            value={brushSize}
            onChange={(e) => onBrushSize(Number(e.target.value))}
            aria-label="Brush size"
          />
        </label>
      )}
      {maskMode === "polygon" && (
        <p className="blob-hint">Tap ≥3 points (auto-closes). Then Apply mask.</p>
      )}
      <div className="blob-timeline-actions">
        <button
          type="button"
          className="blob-btn blob-btn-primary"
          style={{ minHeight: 44 }}
          onClick={onApplyMask}
        >
          Apply mask
        </button>
        <button type="button" className="blob-btn" style={{ minHeight: 44 }} onClick={onClearMask}>
          Clear mask
        </button>
      </div>
    </div>
  );
}
