import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BlobEditor, PrintLayout, type ThemeMode } from "../src/react";
import type { ExportPayload } from "../src/core/types";
import type { PrintExportPayload } from "../src/core/print/types";
import "../src/react/blob-editor.css";

type Mode = "pick" | "composition" | "print";

function solidPngDataUrl(color: string, size = 128): string {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 6;
  ctx.stroke();
  return c.toDataURL("image/png");
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function App() {
  const [mode, setMode] = useState<Mode>("pick");
  const [log, setLog] = useState<string>("");
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");

  const demoAssets = useMemo(
    () => [
      { id: "pink", label: "Pink", color: "#f10ea0" },
      { id: "orange", label: "Orange", color: "#e95214" },
      { id: "teal", label: "Teal", color: "#0aabb5" },
      { id: "violet", label: "Violet", color: "#7c3aed" },
      { id: "lime", label: "Lime", color: "#84cc16" },
      { id: "sky", label: "Sky", color: "#38bdf8" },
    ],
    [],
  );

  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const a of demoAssets) next[a.id] = solidPngDataUrl(a.color);
    setUrls(next);
  }, [demoAssets]);

  const resolveAsset = useCallback(
    async (id: string) => {
      const url = urls[id];
      if (!url) return null;
      return loadImage(url);
    },
    [urls],
  );

  useEffect(() => {
    const dark =
      themeMode === "dark" ||
      (themeMode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.body.classList.toggle("demo-light", !dark);
  }, [themeMode]);

  const themeBar = (
    <div className="theme-bar">
      {(["light", "system", "dark"] as ThemeMode[]).map((m) => (
        <button
          key={m}
          type="button"
          className={themeMode === m ? "is-active" : ""}
          onClick={() => setThemeMode(m)}
        >
          {m}
        </button>
      ))}
      {mode !== "pick" && (
        <button type="button" onClick={() => { setMode("pick"); setLog(""); }}>
          ← Editors
        </button>
      )}
    </div>
  );

  if (mode === "pick") {
    return (
      <>
        <h1>blob editor</h1>
        <p className="hint">Choose an editor</p>
        {themeBar}
        <div className="blob-demo-chooser">
          <button type="button" onClick={() => setMode("composition")}>
            Composition
            <div className="hint">1024² sticker editor</div>
          </button>
          <button type="button" onClick={() => setMode("print")}>
            Print layout
            <div className="hint">A4 / custom page · pack stickers</div>
          </button>
        </div>
      </>
    );
  }

  if (mode === "composition") {
    return (
      <>
        <h1>composition</h1>
        <p className="hint">Pick an image → edit → Export returns document + chat/thumbnail/full PNGs</p>
        {themeBar}
        <BlobEditor
          blocky={false}
          themeMode={themeMode}
          onCancel={() => setMode("pick")}
          onExport={(payload: ExportPayload) => {
            setLog(
              JSON.stringify(
                {
                  background: payload.meta?.background,
                  sizes: {
                    chat: payload.exports.chat.size,
                    thumbnail: payload.exports.thumbnail.size,
                    full: payload.exports.full.size,
                  },
                  document: payload.document,
                },
                null,
                2,
              ),
            );
          }}
        />
        {log && <pre>{log}</pre>}
      </>
    );
  }

  return (
    <>
      <h1>print layout</h1>
      <p className="hint">Add stickers from the tray, Auto grid, or drag freely → Export document + preview PNG</p>
      {themeBar}
      {Object.keys(urls).length > 0 && (
        <PrintLayout
          blocky={false}
          themeMode={themeMode}
          assets={demoAssets.map((a) => ({
            id: a.id,
            label: a.label,
            thumbUrl: urls[a.id],
          }))}
          resolveAsset={resolveAsset}
          onCancel={() => setMode("pick")}
          onExport={(payload: PrintExportPayload) => {
            setLog(
              JSON.stringify(
                {
                  previewPng: payload.previewPng.size,
                  page: payload.document.page,
                  items: payload.document.items.length,
                  document: payload.document,
                },
                null,
                2,
              ),
            );
          }}
        />
      )}
      {log && <pre>{log}</pre>}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
