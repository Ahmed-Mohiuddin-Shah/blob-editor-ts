import type { CompositionDocument, TimeRange } from "../core/types.js";
import { keepDurationMs } from "../core/timing.js";

export interface TimelineProps {
  doc: CompositionDocument;
  playheadMs: number;
  onSeek: (ms: number) => void;
  selectedId: string | null;
  onTrimPrimary: (startMs: number, endMs: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
}

function fmt(ms: number): string {
  const s = ms / 1000;
  return `${s.toFixed(1)}s`;
}

/** GIF/video: trim start/end only (no cut-middle). */
export function Timeline({
  doc,
  playheadMs,
  onSeek,
  selectedId,
  onTrimPrimary,
  playing,
  onTogglePlay,
}: TimelineProps) {
  const duration = Math.max(doc.duration_ms, 1);
  const primary = doc.objects.find((o) => o.type === "media");
  const keep: TimeRange =
    primary && primary.type === "media" && primary.keep
      ? primary.keep
      : { start_ms: 0, end_ms: duration };

  if (doc.duration_ms <= 0) return null;

  const pct = (playheadMs / duration) * 100;
  const keepLen = keepDurationMs(keep) || 1;

  return (
    <div className="blob-timeline" role="group" aria-label="Timeline">
      <div className="blob-timeline-row">
        <button type="button" className="blob-btn" style={{ minWidth: 44, minHeight: 44 }} onClick={onTogglePlay}>
          {playing ? "Pause" : "Play"}
        </button>
        <span className="blob-timeline-time">
          {fmt(playheadMs)} / {fmt(doc.duration_ms)}
        </span>
      </div>
      <div
        className="blob-timeline-track"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = (e.clientX - rect.left) / rect.width;
          onSeek(Math.max(0, Math.min(duration, x * duration)));
        }}
      >
        <div className="blob-timeline-fill" style={{ width: `${pct}%` }} />
        <div className="blob-timeline-playhead" style={{ left: `${pct}%` }} />
        <div
          className="blob-timeline-seg"
          style={{ left: "0%", width: "100%" }}
          title={`${keep.start_ms}-${keep.end_ms} (${keepLen}ms)`}
        />
      </div>
      <div className="blob-timeline-actions">
        <button
          type="button"
          className="blob-btn"
          style={{ minHeight: 44 }}
          disabled={!selectedId}
          onClick={() => {
            onTrimPrimary(keep.start_ms, Math.max(keep.start_ms + 100, keep.start_ms + playheadMs));
          }}
        >
          Trim end→playhead
        </button>
        <button
          type="button"
          className="blob-btn"
          style={{ minHeight: 44 }}
          disabled={!selectedId}
          onClick={() => {
            const start = keep.start_ms + playheadMs;
            onTrimPrimary(start, Math.max(start + 100, keep.end_ms));
          }}
        >
          Trim start→playhead
        </button>
      </div>
    </div>
  );
}
