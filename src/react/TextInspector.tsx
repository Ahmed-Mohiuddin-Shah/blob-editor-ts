import type { TextObject } from "../core/types.js";

export interface TextInspectorProps {
  obj: TextObject;
  onChange: (patch: {
    text?: string;
    font_size?: number;
    style?: Partial<TextObject["style"]>;
  }) => void;
  /** Commit previews when continuous controls finish (slider up / text blur). */
  onCommit: () => void;
}

export function TextInspector({ obj, onChange, onCommit }: TextInspectorProps) {
  const endProps = {
    onPointerUp: onCommit,
    onMouseUp: onCommit,
    onTouchEnd: onCommit,
  };

  return (
    <div className="blob-text-inspector" role="group" aria-label="Text settings">
      <label className="blob-text-field">
        <span>Text</span>
        <input
          type="text"
          value={obj.text}
          onChange={(e) => onChange({ text: e.target.value })}
          onBlur={onCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommit();
          }}
          aria-label="Text content"
        />
      </label>
      <label className="blob-text-field blob-text-size">
        <span>Size {Math.round(obj.font_size)}</span>
        <input
          type="range"
          min={24}
          max={220}
          value={obj.font_size}
          onChange={(e) => onChange({ font_size: Number(e.target.value) })}
          {...endProps}
          aria-label="Font size"
        />
      </label>
      <label className="blob-btn blob-color" style={{ minWidth: 44, minHeight: 44 }}>
        Fill
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(obj.style.fill) ? obj.style.fill : "#ffffff"}
          onChange={(e) => {
            onChange({ style: { fill: e.target.value } });
            onCommit();
          }}
          aria-label="Fill color"
        />
      </label>
      <label className="blob-btn blob-color" style={{ minWidth: 44, minHeight: 44 }}>
        Outline
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(obj.style.stroke) ? obj.style.stroke : "#000000"}
          onChange={(e) => {
            onChange({ style: { stroke: e.target.value } });
            onCommit();
          }}
          aria-label="Outline color"
        />
      </label>
      <label className="blob-text-field blob-text-size">
        <span>Outline {Math.round(obj.style.stroke_width)}</span>
        <input
          type="range"
          min={0}
          max={24}
          value={obj.style.stroke_width}
          onChange={(e) => onChange({ style: { stroke_width: Number(e.target.value) } })}
          {...endProps}
          aria-label="Outline width"
        />
      </label>
    </div>
  );
}
