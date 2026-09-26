# Changelog

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
