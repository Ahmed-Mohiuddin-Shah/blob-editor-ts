import type { CompositionObject } from "../core/types.js";

export interface TransformInspectorProps {
  obj: CompositionObject;
  /** Live canvas update while dragging the slider. */
  onChange: (patch: { scale_x?: number; scale_y?: number; rotation?: number }) => void;
  /** Commit previews / undo when pointer lifts. */
  onCommit: () => void;
}

export function TransformInspector({ obj, onChange, onCommit }: TransformInspectorProps) {
  const scale = obj.transform.scale_x;
  const rotation = ((obj.transform.rotation % 360) + 360) % 360;

  const endProps = {
    onPointerUp: onCommit,
    onMouseUp: onCommit,
    onTouchEnd: onCommit,
  };

  return (
    <div className="blob-transform-inspector" role="group" aria-label="Transform">
      <label className="blob-text-field blob-text-size">
        <span>Scale {scale.toFixed(2)}</span>
        <input
          type="range"
          min={0.05}
          max={10}
          step={0.01}
          value={Math.min(10, Math.max(0.05, scale))}
          onChange={(e) => {
            const s = Number(e.target.value);
            onChange({ scale_x: s, scale_y: s });
          }}
          {...endProps}
          aria-label="Scale"
        />
      </label>
      <label className="blob-text-field blob-text-size">
        <span>Rotate {Math.round(rotation)}°</span>
        <input
          type="range"
          min={0}
          max={360}
          step={1}
          value={rotation}
          onChange={(e) => onChange({ rotation: Number(e.target.value) })}
          {...endProps}
          aria-label="Rotation"
        />
      </label>
    </div>
  );
}
