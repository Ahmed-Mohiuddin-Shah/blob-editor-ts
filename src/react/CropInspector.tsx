import type { MediaObject } from "../core/types.js";

export interface CropInspectorProps {
  obj: MediaObject;
  naturalW: number;
  naturalH: number;
  onChange: (crop: MediaObject["crop"]) => void;
  onCommit: () => void;
}

export function CropInspector({ obj, naturalW, naturalH, onChange, onCommit }: CropInspectorProps) {
  const c = obj.crop ?? { x: 0, y: 0, width: naturalW, height: naturalH };

  const endProps = {
    onPointerUp: onCommit,
    onMouseUp: onCommit,
    onTouchEnd: onCommit,
  };

  const set = (patch: Partial<typeof c>) => {
    const next = { ...c, ...patch };
    // Clamp so the crop stays inside the natural frame.
    next.width = Math.max(1, Math.min(next.width, naturalW));
    next.height = Math.max(1, Math.min(next.height, naturalH));
    next.x = Math.max(0, Math.min(next.x, naturalW - next.width));
    next.y = Math.max(0, Math.min(next.y, naturalH - next.height));
    if (patch.width != null && next.x + next.width > naturalW) {
      next.x = Math.max(0, naturalW - next.width);
    }
    if (patch.height != null && next.y + next.height > naturalH) {
      next.y = Math.max(0, naturalH - next.height);
    }
    onChange(next);
  };

  return (
    <div className="blob-inspector" aria-label="Crop">
      <div className="blob-inspector-title">Crop</div>
      <label className="blob-field blob-text-size">
        <span>X {Math.round(c.x)}</span>
        <input
          type="range"
          min={0}
          max={Math.max(0, naturalW - 1)}
          step={1}
          value={Math.round(c.x)}
          onChange={(e) => set({ x: Number(e.target.value) })}
          {...endProps}
          aria-label="Crop X"
        />
      </label>
      <label className="blob-field blob-text-size">
        <span>Y {Math.round(c.y)}</span>
        <input
          type="range"
          min={0}
          max={Math.max(0, naturalH - 1)}
          step={1}
          value={Math.round(c.y)}
          onChange={(e) => set({ y: Number(e.target.value) })}
          {...endProps}
          aria-label="Crop Y"
        />
      </label>
      <label className="blob-field blob-text-size">
        <span>Width {Math.round(c.width)}</span>
        <input
          type="range"
          min={1}
          max={naturalW}
          step={1}
          value={Math.round(c.width)}
          onChange={(e) => set({ width: Number(e.target.value) })}
          {...endProps}
          aria-label="Crop width"
        />
      </label>
      <label className="blob-field blob-text-size">
        <span>Height {Math.round(c.height)}</span>
        <input
          type="range"
          min={1}
          max={naturalH}
          step={1}
          value={Math.round(c.height)}
          onChange={(e) => set({ height: Number(e.target.value) })}
          {...endProps}
          aria-label="Crop height"
        />
      </label>
      <button
        type="button"
        className="blob-btn"
        style={{ minHeight: 44 }}
        onClick={() => {
          onChange({ x: 0, y: 0, width: naturalW, height: naturalH });
          onCommit();
        }}
      >
        Reset crop
      </button>
    </div>
  );
}
