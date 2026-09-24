# blob-editor

Portable **BLOB Composition** core + React drop-in editor. Document SoT is versioned JSON (1024×1024) — never Konva/Fabric JSON.

## Install

```bash
npm install blob-editor
# peer: react, react-dom >= 18
```

## Drop-in usage

```tsx
import { BlobEditor } from "blob-editor/react";
import "blob-editor/react/blob-editor.css";

<BlobEditor
  // omit sourceAsset → built-in <input type="file" accept="image/*">
  primary="#f10ea0"
  secondary="#e95214"
  onPrimary="#fff"
  onSecondary="#fff"
  blocky={false}
  themeMode="system"   // "light" | "dark" | "system"
  onCancel={() => {}}
  onExport={({ document, exports, meta }) => {
    // exports.chat (128), .thumbnail (256), .full (1024) — PNG Blobs with transforms applied
    // host uploads / persists; editor does not talk to BLOB/GLASS
  }}
/>
```

### Props

| Prop | Meaning |
|------|---------|
| `sourceAsset?` | URL / `File` / `Blob`. If omitted (and no usable `document` media), opens file picker. |
| `document?` | Initial composition JSON (edit / remix). |
| `primary` / `onPrimary` / `secondary` / `onSecondary` | Theme colors |
| `blocky` | `true` = sharp square chrome; `false` = Blobby soft radii |
| `themeMode` | `"light"` \| `"dark"` \| `"system"` (default). Frosted glass chrome follows. |
| `onExport` | `{ document, exports: { chat, thumbnail, full }, mask?, meta? }` |
| `onCancel?` | Dismiss without export |

## Core (no React)

```ts
import {
  validateDocument,
  createFromSource,
  remixDeepCopy,
  renderExports,
  EXPORT_SIZES,
} from "blob-editor/core";
```

- `EXPORT_SIZES`: `{ chat: 128, thumbnail: 256, full: 1024 }`
- Preview ≡ export: one 1024 draw, then scale
- Smart cutout: `applyMask(doc, id, maskAssetId)` — original bytes never mutated

## Text / meme font

Default face is **Anton** (Impact-class meme font, OFL) via `@fontsource/anton`. Document may still say `Impact`; render falls back through `Impact, Anton, …`.

Select a text layer to edit content, size, fill, and outline in the inspector.

## Document sketch

See `docs/blob-requirements.md` §7.1 — `version`, `canvas` 1024², `objects[]` media/text.
