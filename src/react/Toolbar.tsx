export interface ToolbarProps {
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onAddText: () => void;
  onBgTransparent: () => void;
  onBgColor: (hex: string) => void;
  onExport: () => void;
  onCancel?: () => void;
  exporting: boolean;
  background: string;
}

export function Toolbar({
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onAddText,
  onBgTransparent,
  onBgColor,
  onExport,
  onCancel,
  exporting,
  background,
}: ToolbarProps) {
  return (
    <div className="blob-toolbar" role="toolbar" aria-label="Editor tools">
      <button type="button" className="blob-btn" disabled={!canUndo} onClick={onUndo} aria-label="Undo" style={{ minWidth: 44, minHeight: 44 }}>
        Undo
      </button>
      <button type="button" className="blob-btn" disabled={!canRedo} onClick={onRedo} aria-label="Redo" style={{ minWidth: 44, minHeight: 44 }}>
        Redo
      </button>
      <button type="button" className="blob-btn" onClick={onAddText} style={{ minWidth: 44, minHeight: 44 }}>
        Text
      </button>
      <button type="button" className="blob-btn" onClick={onBgTransparent} style={{ minWidth: 44, minHeight: 44 }}>
        Clear bg
      </button>
      <label className="blob-btn blob-color" style={{ minWidth: 44, minHeight: 44 }}>
        Bg
        <input
          type="color"
          value={background === "transparent" ? "#ffffff" : background}
          onChange={(e) => onBgColor(e.target.value as `#${string}`)}
          aria-label="Background color"
        />
      </label>
      <span className="blob-toolbar-spacer" />
      {onCancel && (
        <button type="button" className="blob-btn blob-btn-ghost" onClick={onCancel} style={{ minWidth: 44, minHeight: 44 }}>
          Cancel
        </button>
      )}
      <button
        type="button"
        className="blob-btn blob-btn-primary"
        onClick={onExport}
        disabled={exporting}
        aria-busy={exporting}
        style={{ minWidth: 44, minHeight: 44 }}
      >
        {exporting ? "Export…" : "Export"}
      </button>
    </div>
  );
}
