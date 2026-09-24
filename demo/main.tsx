import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { BlobEditor, type ThemeMode } from "../src/react";
import type { ExportPayload } from "../src/core/types";
import "../src/react/blob-editor.css";

function App() {
  const [log, setLog] = useState<string>("");
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");

  useEffect(() => {
    const dark =
      themeMode === "dark" ||
      (themeMode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.body.classList.toggle("demo-light", !dark);
  }, [themeMode]);

  return (
    <>
      <h1>blob editor</h1>
      <p className="hint">Pick an image → edit → Export returns document + chat/thumbnail/full PNGs</p>
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
      </div>
      <BlobEditor
        blocky={false}
        themeMode={themeMode}
        onCancel={() => setLog("cancelled")}
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

createRoot(document.getElementById("root")!).render(<App />);
