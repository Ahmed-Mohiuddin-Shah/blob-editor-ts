import type { ReactNode } from "react";
import type { ToolId } from "./ToolNav.js";

export interface ToolPanelProps {
  toolId: ToolId | null;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** Collapsible submenu for the active tool category. */
export function ToolPanel({ toolId, title, onClose, children }: ToolPanelProps) {
  if (!toolId) return null;

  return (
    <div className="blob-tool-panel" role="tabpanel" aria-label={title}>
      <div className="blob-tool-panel-head">
        <span className="blob-inspector-title">{title}</span>
        <button
          type="button"
          className="blob-btn blob-btn-ghost blob-tool-panel-close"
          onClick={onClose}
          aria-label="Collapse panel"
          style={{ minWidth: 44, minHeight: 36 }}
        >
          Close
        </button>
      </div>
      <div className="blob-tool-panel-body">{children}</div>
    </div>
  );
}
