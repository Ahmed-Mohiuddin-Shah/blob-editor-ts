# blob-editor

**BLOB Composition** core + React drop-in editor, plus sibling **Print layout** for sticker sheets. Composition source of truth is versioned JSON **v2** (1024×1024) — never Konva/Fabric JSON.

Companion Flutter package: [`blob_editor`](https://pub.dev/packages/blob_editor).

| Entry | Use |
|-------|-----|
| `blob-editor` / `blob-editor/core` | Document ops, validate, render, `prepareSourceMedia` (no React) |
| `blob-editor/react` | `BlobEditor`, `PrintLayout` + CSS |
| `blob-editor/print` | Print document helpers (`pageA4`, `layoutGrid`, …) |
| `blob-editor/encode` | **Node only** — gif/mp4/PDF encode |
| `blob-editor/prepare` | Browser upload compress (`prepareSourceMedia`) |

## Install

```bash
npm install blob-editor
# peer: react, react-dom >= 18
# worker optional: gifenc, ffmpeg-static, pdf-lib
# gif/video encode also needs bytesResolver + omggif (bundled)
```

## Drop-in usage

```tsx
import { BlobEditor } from "blob-editor/react";
import "blob-editor/react/blob-editor.css";

<BlobEditor
  // omit sourceAsset → file picker (image / gif / video)
  primary="#f10ea0"
  secondary="#e95214"
  onPrimary="#fff"
  onSecondary="#fff"
  blocky={false}
  themeMode="system"
  onCancel={() => {}}
  onExport={({ document, exports, mask, meta }) => {
    // document = v2 Composition JSON
    // exports.chat / thumbnail / full = still PNGs
    // mask = baked cutout alpha when brush/polygon/outline used
    // host uploads; server runs encodeComposition for gif/mp4
  }}
/>
```

### Props

| Prop | Meaning |
|------|---------|
| `sourceAsset?` | URL / `File` / `Blob`. If omitted, opens media picker. |
| `document?` | Initial composition JSON (edit / remix); v1 auto-migrates. |
| `primary` / `onPrimary` / `secondary` / `onSecondary` | Theme colors |
| `blocky` | `true` = sharp chrome; `false` = soft radii |
| `themeMode` | `"light"` \| `"dark"` \| `"system"` (default) |
| `maxDurationMs?` | Override default **10 000** ms gif/video duration cap for create/trim/validate. |
| `onExport` | `{ document, exports: { chat, thumbnail, full }, mask?, meta? }` |
| `onCancel?` | Dismiss without export |

Kind-gated UI (image ⊃ gif ⊃ video): crop/scale/rotate/text/undo; BG + multi for image/gif; **brush + polygon mask + outline** for image; trim for gif/video; **Video Settings** pill (mute) for video; Remove (+ Delete) for selected text/overlays.

### Longer (or shorter) duration cap

```tsx
<BlobEditor
  maxDurationMs={15_000} // optional; default 10_000
  onExport={({ document, exports }) => { /* ... */ }}
/>

// Match prepare + encode when you raise the cap:
await prepareSourceMedia(file, { maxDurationMs: 15_000, onProgress });
await encodeComposition(doc, frameResolver, bytesResolver, { maxDurationMs: 15_000 });
```

Pass the **same** `maxDurationMs` to `validateDocument(doc, { maxDurationMs })` when loading remixed docs over 10s.

### Cutout (images)

- **Brush add / remove** — paint keep/cut alpha on the stage (pen cursor; pan disabled while active). Adjustable brush size.
- **Polygon** — tap continuous points, then **Apply mask** to fill the keep region.
- **Apply mask** — commits the live brush/polygon session and exits the tool.
- **Clear mask** — drops `mask_asset_id`.
- **White sticker border** — optional outline with width slider.

Stage composites the same mask as export previews (`destination-in`). No in-package ML / auto remove-BG.

### Layout

Chrome: **header** (Cancel / Undo / Redo / Export) + **tool categories** with a **collapsible submenu**.

Categories (kind / selection gated): Transform · Crop · Cutout · Text · Canvas · Video Settings.

- **Narrow** (&lt;720px): previews → stage → timeline (if animated) → submenu panel → bottom category nav.
- **Wide** (≥720px): tool nav + panel left \| stage + timeline center \| previews right.

Timeline sits under the stage when `duration_ms > 0`, not inside the submenu.

## Core (no React)

```ts
import {
  validateDocument,
  createFromSource,
  renderFrame,
  renderExports,
  remixDeepCopy,
  EXPORT_SIZES,
} from "blob-editor/core";
```

- `EXPORT_SIZES`: `{ chat: 128, thumbnail: 256, full: 1024 }`
- `renderFrame(doc, tMs, resolver)` — shared draw at composition time
- Preview stills ≡ `renderExports` (t=0)

## Encode (Node worker only)

```ts
import { encodeComposition, encodePrint } from "blob-editor/encode";

const payload = await encodeComposition(doc, frameResolver, bytesResolver, {
  maxDurationMs: 15_000, // optional; required if duration_ms > 10_000
});
// payload.exports: chat, thumbnail, full, mask?, gif?, video?
// Budgets: stills ≤2MB, gif ≤3MB, video ≤12MB; duration ≤ maxDurationMs (default 10s)
// gif also emitted for video compositions (composed silent preview)
```

### Prepare before upload (browser)

```ts
import { prepareSourceMedia } from "blob-editor/prepare";
// or: import { prepareSourceMedia } from "blob-editor/core";

const { file, kind, width, height, durationMs } = await prepareSourceMedia(pickedFile, {
  maxDurationMs: 15_000, // optional; default 10_000
  onProgress: ({ phase, ratio }) => {
    // BusyButton: phase decode | compress | done, ratio 0–1
  },
});
// file is under the same caps as encode derivatives
```

**Breaking (0.2):** animated gif/video encode requires a working `bytesResolver` that returns original file bytes. `frameResolver` alone is not enough in Node (no `HTMLVideoElement`). Optional worker deps: `gifenc`, `ffmpeg-static`. Runtime dep `omggif` decodes GIF frames for encode + browser scrub.

When `audio.mute_source === false`, composed mp4 keeps trimmed source audio. No replacement soundtrack mux. New videos default to unmuted.

```ts
const sheet = await encodePrint(printDoc, bytesResolver, { formats: ["png", "pdf"] });
// sheet.exports.png — raster; sheet.exports.pdf — embedded source PNGs

import { combinePdfs, combinePngsGrid } from "blob-editor/encode";
const packPdf = await combinePdfs([sheetA.pdf, sheetB.pdf]);
const contact = await combinePngsGrid([sheetA.png, sheetB.png]); // even grid
```

Do **not** import `blob-editor/encode` in the browser bundle.

## Print layout

Drop-in page composer (A4 / A5 / custom mm). Document stores `asset_id` refs; host resolves sticker PNGs.

```tsx
import { PrintLayout } from "blob-editor/react";
import { pageA4, layoutGrid } from "blob-editor/print";

<PrintLayout
  assets={[{ id: "s1", label: "Cat", thumbUrl }]}
  resolveAsset={async (id) => loadImage(urlFor(id))}
  onExport={({ document, previewPng }) => { /* persist; worker encodePrint for PDF */ }}
/>
```

## Document sketch (v2)

`version: 2`, `canvas` 1024², `duration_ms`, `fps`, `audio: { mute_source } | null`, `objects[]` with media `kind` / single `keep` trim / `mask_asset_id` / `outline`. Snake_case JSON (`scale_x`, `asset_id`, `start_ms`, …).

Host flow: UI exports document + still PNGs (+ optional mask) → POST to server → worker `encodeComposition` → gif/mp4.

## License

MIT
