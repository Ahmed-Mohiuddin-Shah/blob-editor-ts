import type { CompositionDocument } from "../core/types.js";

export interface AudioInspectorProps {
  doc: CompositionDocument;
  onMuteChange: (mute: boolean) => void;
  onCommit: () => void;
}

/** Video-only: mute original sound. */
export function AudioInspector({ doc, onMuteChange, onCommit }: AudioInspectorProps) {
  const hasVideo = doc.objects.some((o) => o.type === "media" && o.kind === "video");
  if (!hasVideo) return null;
  const mute = doc.audio?.mute_source ?? true;

  return (
    <div className="blob-inspector" role="group" aria-label="Audio">
      <label className="blob-field">
        <input
          type="checkbox"
          checked={mute}
          onChange={(e) => {
            onMuteChange(e.target.checked);
            onCommit();
          }}
        />
        Remove original sound
      </label>
    </div>
  );
}
