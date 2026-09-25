export type ToolId = "transform" | "crop" | "cutout" | "text" | "canvas";

export interface ToolNavItem {
  id: ToolId;
  label: string;
  available: boolean;
}

export interface ToolNavProps {
  tools: ToolNavItem[];
  active: ToolId | null;
  onSelect: (id: ToolId) => void;
}

/** Category rail — vertical on wide, horizontal bottom bar on narrow (CSS). */
export function ToolNav({ tools, active, onSelect }: ToolNavProps) {
  const visible = tools.filter((t) => t.available);
  if (!visible.length) return null;

  return (
    <nav className="blob-tool-nav" role="tablist" aria-label="Editor tools">
      {visible.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          className={`blob-tool-nav-item${active === t.id ? " is-active" : ""}`}
          onClick={() => onSelect(t.id)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}
