import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import "@fontsource/anton/400.css";
import {
  addText,
  createFromSource,
  findObject,
  renderExports,
  setBackground,
  updateText,
  updateTransform,
  validateDocument,
  type Background,
  type CompositionDocument,
  type ExportPayload,
  type TextObject,
} from "../core/index.js";
import { DEFAULT_THEME, themeStyle, resolveThemeMode, usePrefersDark, type EditorTheme, type ThemeMode } from "./theme.js";
import { Toolbar } from "./Toolbar.js";
import { PreviewStrip } from "./PreviewStrip.js";
import { EditorStage } from "./EditorStage.js";
import { TextInspector } from "./TextInspector.js";
import { TransformInspector } from "./TransformInspector.js";
import { EXPORT_SIZES } from "../core/sizes.js";
// Host / demo: import "blob-editor/react/blob-editor.css" (or relative styles).

export interface BlobEditorProps {
  /** Optional source media (blob URL, http URL, or File/Blob). */
  sourceAsset?: string | File | Blob;
  /** Optional initial composition (edit / remix). */
  document?: CompositionDocument | unknown;
  primary?: string;
  onPrimary?: string;
  secondary?: string;
  onSecondary?: string;
  /** true = sharp / square chrome; false = Blobby soft radii (default). */
  blocky?: boolean;
  /** light | dark | system (OS preference). Default: system. */
  themeMode?: ThemeMode;
  onExport: (payload: ExportPayload) => void;
  onCancel?: () => void;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load image: ${src}`));
    img.src = src;
  });
}

function useHistory(initial: CompositionDocument | null) {
  const [past, setPast] = useState<CompositionDocument[]>([]);
  const [present, setPresent] = useState<CompositionDocument | null>(initial);
  const [future, setFuture] = useState<CompositionDocument[]>([]);
  const gestureBase = useRef<CompositionDocument | null>(null);
  const presentRef = useRef<CompositionDocument | null>(initial);

  const setPresentSync = (next: CompositionDocument | null) => {
    presentRef.current = next;
    setPresent(next);
  };

  /** Undoable commit (toolbar, drag end, etc.). */
  const push = useCallback((next: CompositionDocument) => {
    setPast((p) => (presentRef.current ? [...p, presentRef.current] : p));
    setPresentSync(next);
    setFuture([]);
    gestureBase.current = null;
  }, []);

  /** Live canvas update while dragging a slider — no undo entry. */
  const live = useCallback((next: CompositionDocument) => {
    if (!gestureBase.current && presentRef.current) gestureBase.current = presentRef.current;
    setPresentSync(next);
  }, []);

  /** Finish a live gesture: one undo step from gesture start. */
  const endLive = useCallback(() => {
    if (gestureBase.current && presentRef.current) {
      const base = gestureBase.current;
      const cur = presentRef.current;
      gestureBase.current = null;
      if (base !== cur) {
        setPast((p) => [...p, base]);
        setFuture([]);
      }
    }
  }, []);

  const undo = useCallback((): CompositionDocument | null => {
    gestureBase.current = null;
    if (!past.length || !presentRef.current) return null;
    const prev = past[past.length - 1];
    const cur = presentRef.current;
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [cur, ...f]);
    setPresentSync(prev);
    return prev;
  }, [past]);

  const redo = useCallback((): CompositionDocument | null => {
    gestureBase.current = null;
    if (!future.length) return null;
    const next = future[0];
    const cur = presentRef.current;
    setFuture((f) => f.slice(1));
    setPast((p) => (cur ? [...p, cur] : p));
    setPresentSync(next);
    return next;
  }, [future]);

  const reset = useCallback((doc: CompositionDocument) => {
    gestureBase.current = null;
    setPast([]);
    setPresentSync(doc);
    setFuture([]);
  }, []);

  return {
    present,
    presentRef,
    push,
    live,
    endLive,
    undo,
    redo,
    reset,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}

export function BlobEditor({
  sourceAsset,
  document: initialDocument,
  primary = DEFAULT_THEME.primary,
  onPrimary = DEFAULT_THEME.onPrimary,
  secondary = DEFAULT_THEME.secondary,
  onSecondary = DEFAULT_THEME.onSecondary,
  blocky = DEFAULT_THEME.blocky,
  themeMode = DEFAULT_THEME.themeMode,
  onExport,
  onCancel,
}: BlobEditorProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [assetUrl, setAssetUrl] = useState<string | null>(null);
  const [assetId] = useState(() => `local_${Math.random().toString(36).slice(2)}`);
  const [images, setImages] = useState<Record<string, HTMLImageElement>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<{ chat?: string; thumbnail?: string; full?: string }>({});
  /** Document snapshot used for export previews — only updates on interaction end. */
  const [previewDoc, setPreviewDoc] = useState<CompositionDocument | null>(null);
  const [activePreview, setActivePreview] = useState<keyof typeof EXPORT_SIZES>("thumbnail");
  const [stageSize, setStageSize] = useState(320);
  const stageWrapRef = useRef<HTMLDivElement>(null);
  const history = useHistory(null);
  const objectUrlRef = useRef<string | null>(null);
  const prefersDark = usePrefersDark();
  const resolved = resolveThemeMode(themeMode, prefersDark);

  const theme: EditorTheme = { primary, onPrimary, secondary, onSecondary, blocky, themeMode };
  const style = themeStyle(theme, resolved) as CSSProperties;

  const commitPreview = useCallback(() => {
    history.endLive();
    if (history.presentRef.current) setPreviewDoc(history.presentRef.current);
  }, [history]);

  const undoWithPreview = useCallback(() => {
    const d = history.undo();
    if (d) setPreviewDoc(d);
  }, [history]);

  const redoWithPreview = useCallback(() => {
    const d = history.redo();
    if (d) setPreviewDoc(d);
  }, [history]);

  // Bootstrap from props or open picker
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      if (initialDocument) {
        const doc = validateDocument(initialDocument);
        history.reset(doc);
        setPreviewDoc(doc);
        // Host must supply resolvable assets separately via sourceAsset for media
        if (sourceAsset) {
          const url =
            typeof sourceAsset === "string"
              ? sourceAsset
              : URL.createObjectURL(sourceAsset);
          if (typeof sourceAsset !== "string") objectUrlRef.current = url;
          const img = await loadImage(url);
          if (cancelled) return;
          const media = doc.objects.find((o) => o.type === "media");
          const id = media && media.type === "media" ? media.asset_id : assetId;
          setAssetUrl(url);
          setImages({ [id]: img });
          setSelectedId(media?.id ?? null);
        }
        return;
      }

      if (sourceAsset) {
        const url =
          typeof sourceAsset === "string" ? sourceAsset : URL.createObjectURL(sourceAsset);
        if (typeof sourceAsset !== "string") objectUrlRef.current = url;
        const img = await loadImage(url);
        if (cancelled) return;
        const doc = createFromSource(assetId, img.naturalWidth, img.naturalHeight);
        setAssetUrl(url);
        setImages({ [assetId]: img });
        history.reset(doc);
        setPreviewDoc(doc);
        setSelectedId(doc.objects[0]?.id ?? null);
        return;
      }

      // No media → built-in picker
      fileRef.current?.click();
    }

    void boot();
    return () => {
      cancelled = true;
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot once on mount
  }, []);

  useEffect(() => {
    const el = stageWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      setStageSize(Math.max(200, Math.min(w, 560)));
    });
    ro.observe(el);
    setStageSize(Math.max(200, Math.min(el.clientWidth, 560)));
    return () => ro.disconnect();
  }, [history.present]);

  // Previews only when previewDoc commits (pointer up / discrete action)
  useEffect(() => {
    if (!previewDoc) return;
    let alive = true;
    const resolver = (id: string) => images[id] ?? null;
    void renderExports(previewDoc, resolver).then((ex) => {
      if (!alive) return;
      setPreviewUrls((prev) => {
        for (const u of Object.values(prev)) if (u) URL.revokeObjectURL(u);
        return {
          chat: URL.createObjectURL(ex.chat),
          thumbnail: URL.createObjectURL(ex.thumbnail),
          full: URL.createObjectURL(ex.full),
        };
      });
    });
    return () => {
      alive = false;
    };
  }, [previewDoc, images]);

  const onFile = useCallback(
    async (file: File | undefined) => {
      if (!file) {
        onCancel?.();
        return;
      }
      const url = URL.createObjectURL(file);
      objectUrlRef.current = url;
      const img = await loadImage(url);
      const doc = createFromSource(assetId, img.naturalWidth, img.naturalHeight);
      setAssetUrl(url);
      setImages({ [assetId]: img });
      history.reset(doc);
      setPreviewDoc(doc);
      setSelectedId(doc.objects[0]?.id ?? null);
    },
    [assetId, history, onCancel],
  );

  const pushAndPreview = useCallback(
    (next: CompositionDocument) => {
      history.push(next);
      setPreviewDoc(next);
    },
    [history],
  );

  const handleExport = useCallback(async () => {
    if (!history.present) return;
    setExporting(true);
    try {
      const exports = await renderExports(history.present, (id) => images[id] ?? null);
      onExport({
        document: history.present,
        exports,
        meta: {
          background: history.present.canvas.background,
          width: 1024,
          height: 1024,
          mimeType: "image/png",
        },
      });
    } finally {
      setExporting(false);
    }
  }, [history.present, images, onExport]);

  const ready = !!history.present && !!assetUrl;

  const bg = history.present?.canvas.background ?? "transparent";

  return (
    <div
      className={`blob-editor${blocky ? " is-blocky" : ""}${resolved === "dark" ? " is-dark" : " is-light"}`}
      style={style}
      data-theme={resolved}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => void onFile(e.target.files?.[0])}
      />

      {!ready && (
        <div className="blob-editor-empty">
          <p>Pick an image to start</p>
          <button type="button" className="blob-btn blob-btn-primary" style={{ minHeight: 44 }} onClick={() => fileRef.current?.click()}>
            Choose image
          </button>
          {onCancel && (
            <button type="button" className="blob-btn blob-btn-ghost" style={{ minHeight: 44 }} onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      )}

      {ready && history.present && (
        <>
          <div className="blob-editor-workspace">
            <div className="blob-editor-main" ref={stageWrapRef}>
              <EditorStage
                doc={history.present}
                images={images}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onDocumentChange={history.push}
                onInteractionEnd={commitPreview}
                width={stageSize}
                height={stageSize}
              />
            </div>
            <div className="blob-editor-controls">
              {(() => {
                const sel = selectedId ? findObject(history.present, selectedId) : undefined;
                if (!sel) return null;
                return (
                  <>
                    <TransformInspector
                      obj={sel}
                      onChange={(patch) => history.live(updateTransform(history.present!, sel.id, patch))}
                      onCommit={commitPreview}
                    />
                    {sel.type === "text" && (
                      <TextInspector
                        obj={sel as TextObject}
                        onChange={(patch) => history.live(updateText(history.present!, sel.id, patch))}
                        onCommit={commitPreview}
                      />
                    )}
                  </>
                );
              })()}
              <Toolbar
                onUndo={undoWithPreview}
                onRedo={redoWithPreview}
                canUndo={history.canUndo}
                canRedo={history.canRedo}
                onAddText={() => {
                  const next = addText(history.present!);
                  const added = next.objects[next.objects.length - 1];
                  pushAndPreview(next);
                  setSelectedId(added.id);
                }}
                onBgTransparent={() => pushAndPreview(setBackground(history.present!, "transparent"))}
                onBgColor={(hex) => pushAndPreview(setBackground(history.present!, hex as Background))}
                onExport={() => void handleExport()}
                onCancel={onCancel}
                exporting={exporting}
                background={bg}
              />
            </div>
            <div className="blob-editor-rail">
              <PreviewStrip urls={previewUrls} active={activePreview} onSelect={setActivePreview} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default BlobEditor;
