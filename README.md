# blob-editor

Portable **BLOB Composition** core + React drop-in editor. Document SoT is versioned JSON **v2** (1024×1024) — never Konva/Fabric JSON.

See repo [`docs/diff.md`](../docs/diff.md) for host/worker migration and TS vs Flutter gaps.

## Install

```bash
npm install blob-editor
# peer: react, react-dom >= 18
# worker optional: gifenc, ffmpeg-static
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
    // document = v2 Composition JSON (SoT)
    // exports.chat / thumbnail / full = still PNGs
    // mask = baked cutout alpha when brush/polygon/outline used
    // host uploads + server runs encodeComposition for gif/mp4
  }}
/>
```

### Props

| Prop | Meaning |
|------|---------|
| `sourceAsset?` | URL / `File` / `Blob`. If omitted, opens media picker. |
| `document?` | Initial composition JSON (edit / remix); v1 auto-migrates. |
| `primary` / `onPrimary` / `secondary` / `onSecondary` | Theme colors |
| `blocky` | `true` = sharp square chrome; `false` = Blobby soft radii |
| `themeMode` | `"light"` \| `"dark"` \| `"system"` (default) |
| `onExport` | `{ document, exports: { chat, thumbnail, full }, mask?, meta? }` |
| `onCancel?` | Dismiss without export |

Kind-gated UI (image ⊃ gif ⊃ video): crop/scale/rotate/text/undo; BG + multi for image/gif; **brush + polygon mask + outline** for image; trim for gif/video; mute for video.

### Cutout (images)

- **Brush add / remove** — paint keep/cut alpha on the stage (pen cursor; pan disabled while active). Adjustable brush size.
- **Polygon** — tap continuous points, then **Apply mask** to fill the keep region.
- **Apply mask** — commits the live brush/polygon session and exits the tool.
- **Clear mask** — drops `mask_asset_id`.
- **White sticker border** — optional outline with width slider.

The editor stage composites the same mask as export previews (`destination-in`).

### Layout

Chrome: **header** (Cancel / Undo / Redo / Export) + **tool categories** with a **collapsible submenu**.

Categories (kind / selection gated): Transform · Crop · Cutout · Text · Canvas.

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
import { encodeComposition } from "blob-editor/encode";

const payload = await encodeComposition(doc, frameResolver, bytesResolver);
// payload.exports: chat, thumbnail, full, mask?, gif?, video?
```

Do **not** import `blob-editor/encode` in the browser bundle.

## Document sketch (v2)

`version: 2`, `canvas` 1024², `duration_ms`, `fps`, `audio: { mute_source } | null`, `objects[]` with media `kind` / single `keep` trim / `mask_asset_id` / `outline`. See `docs/diff.md`.
