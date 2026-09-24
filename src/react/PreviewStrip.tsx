import { EXPORT_SIZES } from "../core/sizes.js";

export interface PreviewStripProps {
  urls: { chat?: string; thumbnail?: string; full?: string };
  active: keyof typeof EXPORT_SIZES;
  onSelect: (k: keyof typeof EXPORT_SIZES) => void;
}

const LABELS: Record<keyof typeof EXPORT_SIZES, string> = {
  chat: "Chat 128",
  thumbnail: "Thumb 256",
  full: "Full 1024",
};

/** UI frame sizes keep the real 128:256:1024 ratio (1:2:8), capped so the strip fits. */
const PREVIEW_UI: Record<keyof typeof EXPORT_SIZES, number> = {
  chat: 40,
  thumbnail: 80,
  full: 160,
};

export function PreviewStrip({ urls, active, onSelect }: PreviewStripProps) {
  return (
    <div className="blob-previews" role="tablist" aria-label="Export previews">
      {(Object.keys(EXPORT_SIZES) as (keyof typeof EXPORT_SIZES)[]).map((key) => {
        const px = PREVIEW_UI[key];
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active === key}
            className={`blob-preview-tab${active === key ? " is-active" : ""}`}
            onClick={() => onSelect(key)}
          >
            <span className="blob-preview-label">{LABELS[key]}</span>
            <div className="blob-preview-frame" style={{ width: px, height: px }}>
              {urls[key] ? (
                <img src={urls[key]} alt={LABELS[key]} width={px} height={px} />
              ) : (
                <div className="blob-preview-empty" />
              )}
            </div>
            <span className="blob-preview-px">{EXPORT_SIZES[key]}×{EXPORT_SIZES[key]}</span>
          </button>
        );
      })}
    </div>
  );
}
