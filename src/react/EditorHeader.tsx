export interface EditorHeaderProps {
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onExport: () => void;
  onCancel?: () => void;
  exporting: boolean;
}

/** Global chrome: cancel / undo / redo / export. */
export function EditorHeader({
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onExport,
  onCancel,
  exporting,
}: EditorHeaderProps) {
  return (
    <header className="blob-editor-header" role="banner">
      {onCancel && (
        <button
          type="button"
          className="blob-btn blob-btn-ghost"
          onClick={onCancel}
          style={{ minWidth: 44, minHeight: 44 }}
          aria-label="Cancel"
        >
          Cancel
        </button>
      )}
      <button
        type="button"
        className="blob-btn"
        disabled={!canUndo}
        onClick={onUndo}
        aria-label="Undo"
        style={{ minWidth: 44, minHeight: 44 }}
      >
        Undo
      </button>
      <button
        type="button"
        className="blob-btn"
        disabled={!canRedo}
        onClick={onRedo}
        aria-label="Redo"
        style={{ minWidth: 44, minHeight: 44 }}
      >
        Redo
      </button>
      <span className="blob-toolbar-spacer" />
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
    </header>
  );
}
