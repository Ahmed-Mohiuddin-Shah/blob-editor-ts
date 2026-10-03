# Changelog

## 0.4.0

### Encode format matrix

- **IMAGE:** chat / thumbnail / full remain stills (PNG→WebP/JPEG ladder).
- **GIF:** chat (128) / thumbnail (256) / full (≤1024, budget may shrink) are `image/gif`.
- **VIDEO:** thumbnail is silent `image/gif` @256; chat @128 and full @1024 are `video/mp4`.
- `meta.firstFramePng` — first-frame still PNG for host WhatsApp OG (never gif/mp4).
- `exports.gif` / `exports.video` alias thumbnail GIF / full MP4 for type detection.
- `encodeGifUnderBudget(..., maxBytes?, maxEdge?)` — optional max edge per size slot.

## 0.3.0

### Fixes

- **Video preview audio:** Timeline play drives `HTMLVideoElement.play()` and syncs mute from `audio.mute_source` (was always muted + seek-only, so unmuting had no effect).
- **Smooth video play:** Skip seek-per-frame while playing; scrub still seeks when paused.

### Features

- **Video Settings** tool pill with `VideoSettingsInspector` (mute / remove original sound).
- **Remove** selected text or overlay (button + Delete/Backspace); primary media cannot be removed.
- **`maxDurationMs`** optional override (default 10 000) on `BlobEditor`, `createFromSource` / `syncDurationFromPrimary` / `setDuration`, `validateDocument`, `prepareSourceMedia`, and `encodeComposition`.
- New videos default to **`mute_source: false`** (sound on).

## 0.2.1

### Fixes

- **Video ENOENT:** `extractVideoFrame` verifies PNG exists and is non-empty after ffmpeg; retries accurate `-ss` (after `-i`), clamps seek near EOF, then reuses last good cached frame. Composition sample times avoid exact `duration_ms`.
- **GIF bloat:** Animated GIF derivatives encode at ≤512² with a shared palette and iterative color/frame reduction until ≤3 MB (no more naive 1024² × per-frame 256).

### Encode budgets

- Stills (chat / thumbnail / full): ≤2 MB each (WebP/JPEG ladder when PNG is too large).
- GIF: ≤3 MB.
- Video mp4: ≤10 s (unchanged) and ≤12 MB (CRF ladder).

### Features

- **`prepareSourceMedia(file, { onProgress })`** — browser helper (`blob-editor/prepare` or `blob-editor/core`) compresses image/gif/video under the same caps before upload. Progress phases: `decode` | `compress` | `done`.

## 0.2.0

### Fixes

- **GIF animate:** React stage + encode decode multi-frame GIF bytes (`omggif`); scrub playhead changes pixels; `duration_ms` / fps from GIF delays (clamped ≤10s).
- **Video encode black:** `encodeComposition` uses `bytesResolver` to extract video frames via ffmpeg at `mapCompToSource` times, then draws through the same `renderFrame` crop/transform/text path.
- **GIF encode static:** same path — source frames from bytes, not a first-frame still.

### Encode contract

- **Requires a working `bytesResolver` for gif/video** (original file bytes). Do not rely on host-decoding into `frameResolver` for Node.
- Video compositions also emit `exports.gif` (silent composed preview).
- `mute_source: false` preserves trimmed source audio on mp4; muted stays `-an`. No soundtrack mux.
- Stills (chat/thumbnail/full) use the first composed frame (non-black when bytes resolve).

### Dependencies

- Added runtime dependency `omggif`.
- Optional: `gifenc`, `ffmpeg-static` (unchanged).

## 0.1.0

- Initial release.
