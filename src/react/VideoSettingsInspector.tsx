import type { CompositionDocument } from "../core/types.js";

export interface VideoSettingsInspectorProps {
  doc: CompositionDocument;
  onMuteChange: (mute: boolean) => void;
  onCommit: () => void;
}

/** Video-only: mute original sound. */
export function VideoSettingsInspector({ doc, onMuteChange, onCommit }: VideoSettingsInspectorProps) {
  const hasVideo = doc.objects.some((o) => o.type === "media" && o.kind === "video");
  if (!hasVideo) return null;
  const mute = doc.audio?.mute_source ?? false;

  return (
    <div className="blob-inspector" role="group" aria-label="Video settings">
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
