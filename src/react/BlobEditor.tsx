import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import "@fontsource/anton/400.css";
import {
  addMedia,
  addText,
  applyMask,
  createFromSource,
  findObject,
  newObjectId,
  renderExports,
  renderMaskBlob,
  setBackground,
  setMuteSource,
  setOutline,
  setTrim,
  syncDurationFromPrimary,
  updateCrop,
  updateText,
  updateTransform,
  validateDocument,
  type Background,
  type CompositionDocument,
  type ExportPayload,
  type MediaKind,
  type MediaObject,
  type TextObject,
} from "../core/index.js";
import { DEFAULT_THEME, themeStyle, resolveThemeMode, usePrefersDark, type EditorTheme, type ThemeMode } from "./theme.js";
import { PreviewStrip } from "./PreviewStrip.js";
import { EditorStage, type MaskToolMode } from "./EditorStage.js";
import { TextInspector } from "./TextInspector.js";
import { TransformInspector } from "./TransformInspector.js";
import { Timeline } from "./Timeline.js";
import { CropInspector } from "./CropInspector.js";
import { CutoutInspector } from "./CutoutInspector.js";
import { AudioInspector } from "./AudioInspector.js";
import { EditorHeader } from "./EditorHeader.js";
import { ToolNav, type ToolId } from "./ToolNav.js";
import { ToolPanel } from "./ToolPanel.js";
import { EXPORT_SIZES } from "../core/sizes.js";

const TOOL_TITLES: Record<ToolId, string> = {
  transform: "Transform",
  crop: "Crop",
  cutout: "Cutout",
  text: "Text",
  canvas: "Canvas",
};

export type StageImage = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;

export interface BlobEditorProps {
  sourceAsset?: string | File | Blob;
  document?: CompositionDocument | unknown;
  primary?: string;
  onPrimary?: string;
  secondary?: string;
  onSecondary?: string;
  blocky?: boolean;
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

function loadVideo(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.onerror = () => reject(new Error(`failed to load video: ${src}`));
    v.onloadeddata = () => {
      void (async () => {
        try {
          await v.play();
          v.pause();
        } catch {
          /* autoplay blocked */
        }
        if (v.videoWidth === 0) {
          await new Promise<void>((r) => {
            const done = () => {
              v.removeEventListener("seeked", done);
              r();
            };
            v.addEventListener("seeked", done);
            v.currentTime = 0.001;
          });
        }
        resolve(v);
      })();
    };
    v.src = src;
  });
}

function inferKind(file: File | Blob | string): MediaKind {
  const name = typeof file === "string" ? file : "type" in file ? file.type : "";
  const n = typeof file === "string" ? file.toLowerCase() : "name" in file ? String((file as File).name ?? "").toLowerCase() : "";
  if (name.includes("video") || /\.(mp4|webm|mov)(\?|$)/i.test(n)) return "video";
  if (name.includes("gif") || /\.gif(\?|$)/i.test(n)) return "gif";
  return "image";
}

function naturalDims(img: StageImage): { nw: number; nh: number } {
  if (img instanceof HTMLVideoElement) return { nw: img.videoWidth, nh: img.videoHeight };
  if (img instanceof HTMLCanvasElement) return { nw: img.width, nh: img.height };
  return { nw: img.naturalWidth, nh: img.naturalHeight };
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

  const push = useCallback((next: CompositionDocument) => {
    setPast((p) => (presentRef.current ? [...p, presentRef.current] : p));
    setPresentSync(next);
    setFuture([]);
    gestureBase.current = null;
  }, []);

  const live = useCallback((next: CompositionDocument) => {
    if (!gestureBase.current && presentRef.current) gestureBase.current = presentRef.current;
    setPresentSync(next);
  }, []);

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

/** Ensure a full-size mask canvas; white = keep. */
function ensureMaskCanvas(
  media: MediaObject,
  images: Record<string, StageImage>,
  maskId: string,
): { canvas: HTMLCanvasElement; maskId: string; nw: number; nh: number } | null {
  const img = images[media.asset_id];
  if (!img) return null;
  const { nw, nh } = naturalDims(img);
  if (!nw || !nh) return null;
  const canvas = document.createElement("canvas");
  canvas.width = nw;
  canvas.height = nh;
  const ctx = canvas.getContext("2d")!;
  const prev = images[maskId];
  if (prev) ctx.drawImage(prev, 0, 0);
  else {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, nw, nh);
  }
  return { canvas, maskId, nw, nh };
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
  const overlayRef = useRef<HTMLInputElement>(null);
  const [assetUrl, setAssetUrl] = useState<string | null>(null);
  const [images, setImages] = useState<Record<string, StageImage>>({});
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<{ chat?: string; thumbnail?: string; full?: string }>({});
  const [previewDoc, setPreviewDoc] = useState<CompositionDocument | null>(null);
  const [activePreview, setActivePreview] = useState<keyof typeof EXPORT_SIZES>("thumbnail");
  const [stageSize, setStageSize] = useState(320);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [maskMode, setMaskMode] = useState<MaskToolMode>(null);
  const [brushSize, setBrushSize] = useState(28);
  const [polygonPoints, setPolygonPoints] = useState<{ x: number; y: number }[]>([]);
  const [activeTool, setActiveTool] = useState<ToolId | null>("text");
  const stageWrapRef = useRef<HTMLDivElement>(null);
  const history = useHistory(null);
  const objectUrls = useRef<string[]>([]);
  const prefersDark = usePrefersDark();
  const resolved = resolveThemeMode(themeMode, prefersDark);

  const theme: EditorTheme = { primary, onPrimary, secondary, onSecondary, blocky, themeMode };
  const style = themeStyle(theme, resolved) as CSSProperties;

  const trackUrl = (url: string) => {
    objectUrls.current.push(url);
    return url;
  };

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

  const bootFromUrl = useCallback(
    async (url: string, kind: MediaKind) => {
      const assetId = `local_${Math.random().toString(36).slice(2)}`;
      if (kind === "video") {
        const v = await loadVideo(url);
        const durationMs = Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : 3000;
        const doc = createFromSource(assetId, v.videoWidth || 1024, v.videoHeight || 1024, "#000000", {
          kind: "video",
          durationMs: Math.min(10_000, durationMs),
        });
        setAssetUrl(url);
        setImages({ [assetId]: v });
        history.reset(doc);
        setPreviewDoc(doc);
        setSelectedId(doc.objects[0]?.id ?? null);
        setPlayheadMs(0);
        return;
      }
      const img = await loadImage(url);
      // ponytail: web GIF = first frame still for duration scrub; real decode is host/encode
      const doc = createFromSource(assetId, img.naturalWidth, img.naturalHeight, "transparent", {
        kind,
        durationMs: kind === "gif" ? 3000 : 0,
      });
      setAssetUrl(url);
      setImages({ [assetId]: img });
      history.reset(doc);
      setPreviewDoc(doc);
      setSelectedId(doc.objects[0]?.id ?? null);
      setPlayheadMs(0);
    },
    [history],
  );

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      if (initialDocument) {
        const doc = validateDocument(initialDocument);
        history.reset(doc);
        setPreviewDoc(doc);
        if (sourceAsset) {
          const url =
            typeof sourceAsset === "string" ? sourceAsset : trackUrl(URL.createObjectURL(sourceAsset));
          const kind = inferKind(sourceAsset);
          if (kind === "video") {
            const v = await loadVideo(url);
            if (cancelled) return;
            const media = doc.objects.find((o) => o.type === "media");
            const id = media && media.type === "media" ? media.asset_id : `local_${Math.random().toString(36).slice(2)}`;
            setAssetUrl(url);
            setImages({ [id]: v });
            setSelectedId(media?.id ?? null);
          } else {
            const img = await loadImage(url);
            if (cancelled) return;
            const media = doc.objects.find((o) => o.type === "media");
            const id = media && media.type === "media" ? media.asset_id : `local_${Math.random().toString(36).slice(2)}`;
            setAssetUrl(url);
            setImages({ [id]: img });
            setSelectedId(media?.id ?? null);
          }
        }
        return;
      }
      if (sourceAsset) {
        const url =
          typeof sourceAsset === "string" ? sourceAsset : trackUrl(URL.createObjectURL(sourceAsset));
        if (cancelled) return;
        await bootFromUrl(url, inferKind(sourceAsset));
        return;
      }
      fileRef.current?.click();
    }
    void boot();
    return () => {
      cancelled = true;
      for (const u of objectUrls.current) URL.revokeObjectURL(u);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = stageWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setStageSize(Math.max(200, Math.min(el.clientWidth, 560)));
    });
    ro.observe(el);
    setStageSize(Math.max(200, Math.min(el.clientWidth, 560)));
    return () => ro.disconnect();
  }, [history.present]);

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

  useEffect(() => {
    if (!playing || !history.present || history.present.duration_ms <= 0) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      setPlayheadMs((t) => {
        const next = t + dt;
        if (next >= (history.presentRef.current?.duration_ms ?? 0)) {
          setPlaying(false);
          return 0;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, history.present, history.presentRef]);

  useEffect(() => {
    if (maskMode !== "polygon") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPolygonPoints([]);
        setMaskMode(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maskMode]);

  const onFile = useCallback(
    async (file: File | undefined) => {
      if (!file) {
        onCancel?.();
        return;
      }
      const url = trackUrl(URL.createObjectURL(file));
      await bootFromUrl(url, inferKind(file));
    },
    [bootFromUrl, onCancel],
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
      const resolver = (id: string) => images[id] ?? null;
      const exports = await renderExports(history.present, resolver);
      const mask = (await renderMaskBlob(history.present, resolver)) ?? undefined;
      onExport({
        document: history.present,
        exports,
        mask,
        meta: {
          background: history.present.canvas.background,
          width: 1024,
          height: 1024,
          mimeType: "image/png",
          duration_ms: history.present.duration_ms,
          has_audio: history.present.audio?.mute_source === false,
        },
      });
    } finally {
      setExporting(false);
    }
  }, [history.present, images, onExport]);

  const addOverlayFile = useCallback(
    async (file: File | undefined) => {
      if (!file || !history.present) return;
      const kind = inferKind(file);
      if (kind === "video") return; // overlays: images + GIFs only
      const url = trackUrl(URL.createObjectURL(file));
      const assetId = newObjectId("ov");
      const img = await loadImage(url);
      setImages((prev) => ({ ...prev, [assetId]: img }));
      try {
        pushAndPreview(
          addMedia(history.present, {
            asset_id: assetId,
            kind,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
          }),
        );
      } catch {
        /* video composition / invalid overlay */
      }
    },
    [history.present, pushAndPreview],
  );

  /** Crop-aware soft circle into mask; stage + render share the same mask asset. */
  const paintBrush = useCallback(
    (media: MediaObject, canvasX: number, canvasY: number, mode: "add" | "remove", radius: number) => {
      const maskId = media.mask_asset_id ?? newObjectId("mask");
      setImages((prev) => {
        const ensured = ensureMaskCanvas(media, prev, maskId);
        if (!ensured) return prev;
        const { canvas, nw, nh } = ensured;
        const ctx = canvas.getContext("2d")!;
        const crop = media.crop;
        const iw = crop?.width ?? nw;
        const ih = crop?.height ?? nh;
        const sx = crop?.x ?? 0;
        const sy = crop?.y ?? 0;
        const lx = (canvasX - media.transform.x) / Math.max(media.transform.scale_x, 0.01) + iw / 2 + sx;
        const ly = (canvasY - media.transform.y) / Math.max(media.transform.scale_y, 0.01) + ih / 2 + sy;
        ctx.globalCompositeOperation = mode === "add" ? "source-over" : "destination-out";
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(lx, ly, radius / Math.max(media.transform.scale_x, 0.01), 0, Math.PI * 2);
        ctx.fill();
        return { ...prev, [maskId]: canvas };
      });
      if (!history.presentRef.current) return;
      history.live(applyMask(history.presentRef.current, media.id, maskId));
    },
    [history],
  );

  const applyPolygonMask = useCallback(
    (media: MediaObject, points: { x: number; y: number }[]) => {
      if (points.length < 3) return false;
      const maskId = media.mask_asset_id ?? newObjectId("mask");
      const prev = imagesRef.current;
      const img = prev[media.asset_id];
      if (!img) return false;
      const { nw, nh } = naturalDims(img);
      if (!nw || !nh) return false;
      const crop = media.crop;
      const iw = crop?.width ?? nw;
      const ih = crop?.height ?? nh;
      const sx = crop?.x ?? 0;
      const sy = crop?.y ?? 0;

      const canvas = document.createElement("canvas");
      canvas.width = nw;
      canvas.height = nh;
      const ctx = canvas.getContext("2d")!;

      // Preserve existing mask (or full keep), then intersect with closed polygon.
      const existing = prev[maskId];
      if (existing) ctx.drawImage(existing, 0, 0);
      else {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, nw, nh);
      }

      const poly = document.createElement("canvas");
      poly.width = nw;
      poly.height = nh;
      const pctx = poly.getContext("2d")!;
      pctx.fillStyle = "#fff";
      pctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const lx =
          (points[i].x - media.transform.x) / Math.max(media.transform.scale_x, 0.01) + iw / 2 + sx;
        const ly =
          (points[i].y - media.transform.y) / Math.max(media.transform.scale_y, 0.01) + ih / 2 + sy;
        if (i === 0) pctx.moveTo(lx, ly);
        else pctx.lineTo(lx, ly);
      }
      pctx.closePath(); // auto-close last → first
      pctx.fill();

      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(poly, 0, 0);
      ctx.globalCompositeOperation = "source-over";

      setImages((p) => ({ ...p, [maskId]: canvas }));
      if (!history.presentRef.current) return false;
      history.live(applyMask(history.presentRef.current, media.id, maskId));
      return true;
    },
    [history],
  );

  const handleApplyMask = useCallback(() => {
    const media =
      selectedId && history.presentRef.current
        ? findObject(history.presentRef.current, selectedId)
        : null;
    if (media?.type === "media" && media.kind === "image" && maskMode === "polygon") {
      if (polygonPoints.length < 3) return; // need a closable shape; keep points
      const ok = applyPolygonMask(media, polygonPoints);
      if (!ok) return;
    }
    setPolygonPoints([]);
    setMaskMode(null);
    commitPreview();
  }, [selectedId, maskMode, polygonPoints, applyPolygonMask, commitPreview]);

  const handleMaskMode = useCallback((mode: MaskToolMode) => {
    setPolygonPoints([]);
    setMaskMode(mode);
  }, []);

  const ready = !!history.present && !!assetUrl;
  const bg = history.present?.canvas.background ?? "transparent";
  const sel = selectedId && history.present ? findObject(history.present, selectedId) : undefined;
  const selMedia = sel?.type === "media" ? (sel as MediaObject) : null;
  const primaryMedia = history.present?.objects.find((o) => o.type === "media") as MediaObject | undefined;
  const isVideo = primaryMedia?.kind === "video";
  const showOverlay = !isVideo;
  const showBackground = !isVideo;
  const hasVideo = !!history.present?.objects.some((o) => o.type === "media" && o.kind === "video");

  const toolsAvailable = {
    transform: !!sel,
    crop: !!selMedia,
    cutout: selMedia?.kind === "image",
    text: true,
    canvas: showBackground || hasVideo,
  };

  // Keep active tool valid when selection/kind changes; default to first available.
  useEffect(() => {
    if (activeTool && toolsAvailable[activeTool]) return;
    const next: ToolId | null = sel
      ? sel.type === "text"
        ? "text"
        : toolsAvailable.cutout
          ? "transform"
          : toolsAvailable.transform
            ? "transform"
            : "text"
      : "text";
    setActiveTool(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selMedia?.kind, sel?.type, showBackground, hasVideo]);

  const selectTool = useCallback((id: ToolId) => {
    setActiveTool((cur) => (cur === id ? null : id));
  }, []);

  const mediaNatural = (assetId: string): { w: number; h: number } => {
    const img = images[assetId];
    if (!img) return { w: 1024, h: 1024 };
    if (img instanceof HTMLCanvasElement) return { w: img.width || 1024, h: img.height || 1024 };
    if (img instanceof HTMLVideoElement) return { w: img.videoWidth || 1024, h: img.videoHeight || 1024 };
    return { w: img.naturalWidth || 1024, h: img.naturalHeight || 1024 };
  };

  return (
    <div
      className={`blob-editor${blocky ? " is-blocky" : ""}${resolved === "dark" ? " is-dark" : " is-light"}`}
      style={style}
      data-theme={resolved}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*,.gif"
        hidden
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <input
        ref={overlayRef}
        type="file"
        accept="image/*,.gif,image/gif"
        hidden
        onChange={(e) => void addOverlayFile(e.target.files?.[0])}
      />

      {!ready && (
        <div className="blob-editor-empty">
          <p>Pick an image, GIF, or video to start</p>
          <button type="button" className="blob-btn blob-btn-primary" style={{ minHeight: 44 }} onClick={() => fileRef.current?.click()}>
            Choose media
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
          <EditorHeader
            onUndo={undoWithPreview}
            onRedo={redoWithPreview}
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            onExport={() => void handleExport()}
            onCancel={onCancel}
            exporting={exporting}
          />
          <div className="blob-editor-workspace">
            <div className="blob-editor-rail">
              <PreviewStrip urls={previewUrls} active={activePreview} onSelect={setActivePreview} />
            </div>

            <div className="blob-editor-stage-col">
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
                  playheadMs={playheadMs}
                  maskMode={maskMode}
                  brushSize={brushSize}
                  onBrushPaint={(x, y) => {
                    if ((maskMode === "add" || maskMode === "remove") && selMedia?.kind === "image") {
                      paintBrush(selMedia, x, y, maskMode, brushSize);
                    }
                  }}
                  polygonPoints={polygonPoints}
                  onPolygonPoint={(x, y) => {
                    if (maskMode === "polygon") setPolygonPoints((pts) => [...pts, { x, y }]);
                  }}
                />
              </div>
              <Timeline
                doc={history.present}
                playheadMs={playheadMs}
                onSeek={setPlayheadMs}
                selectedId={primaryMedia?.id ?? null}
                playing={playing}
                onTogglePlay={() => setPlaying((p) => !p)}
                onTrimPrimary={(startMs, endMs) => {
                  if (!primaryMedia) return;
                  const next = syncDurationFromPrimary(setTrim(history.present!, primaryMedia.id, startMs, endMs));
                  pushAndPreview(next);
                }}
              />
            </div>

            <div className="blob-editor-tools">
              <ToolNav
                tools={(
                  [
                    { id: "transform", label: "Transform", available: toolsAvailable.transform },
                    { id: "crop", label: "Crop", available: toolsAvailable.crop },
                    { id: "cutout", label: "Cutout", available: toolsAvailable.cutout },
                    { id: "text", label: "Text", available: toolsAvailable.text },
                    { id: "canvas", label: "Canvas", available: toolsAvailable.canvas },
                  ] as const
                ).map((t) => ({ ...t }))}
                active={activeTool}
                onSelect={selectTool}
              />
              <ToolPanel
                toolId={activeTool && toolsAvailable[activeTool] ? activeTool : null}
                title={activeTool ? TOOL_TITLES[activeTool] : ""}
                onClose={() => setActiveTool(null)}
              >
                {activeTool === "transform" && sel && (
                  <TransformInspector
                    obj={sel}
                    onChange={(patch) => history.live(updateTransform(history.present!, sel.id, patch))}
                    onCommit={commitPreview}
                  />
                )}
                {activeTool === "crop" && selMedia && (
                  <CropInspector
                    obj={selMedia}
                    naturalW={mediaNatural(selMedia.asset_id).w}
                    naturalH={mediaNatural(selMedia.asset_id).h}
                    onChange={(crop) => history.live(updateCrop(history.present!, selMedia.id, crop))}
                    onCommit={commitPreview}
                  />
                )}
                {activeTool === "cutout" && selMedia?.kind === "image" && (
                  <CutoutInspector
                    obj={selMedia}
                    maskMode={maskMode}
                    brushSize={brushSize}
                    onBrushSize={setBrushSize}
                    onOutline={(o) => {
                      history.live(setOutline(history.present!, selMedia.id, o));
                    }}
                    onMaskMode={handleMaskMode}
                    onClearMask={() => {
                      setMaskMode(null);
                      setPolygonPoints([]);
                      pushAndPreview(applyMask(history.present!, selMedia.id, null));
                    }}
                    onApplyMask={handleApplyMask}
                    onCommit={commitPreview}
                  />
                )}
                {activeTool === "text" && (
                  <div className="blob-tool-stack">
                    <div className="blob-timeline-actions">
                      <button
                        type="button"
                        className="blob-btn"
                        style={{ minHeight: 44 }}
                        onClick={() => {
                          const next = addText(history.present!);
                          const added = next.objects[next.objects.length - 1];
                          pushAndPreview(next);
                          setSelectedId(added.id);
                        }}
                      >
                        Add text
                      </button>
                      {showOverlay && (
                        <button
                          type="button"
                          className="blob-btn"
                          style={{ minHeight: 44 }}
                          onClick={() => overlayRef.current?.click()}
                        >
                          Overlay
                        </button>
                      )}
                    </div>
                    {sel?.type === "text" && (
                      <TextInspector
                        obj={sel as TextObject}
                        onChange={(patch) => history.live(updateText(history.present!, sel.id, patch))}
                        onCommit={commitPreview}
                      />
                    )}
                  </div>
                )}
                {activeTool === "canvas" && (
                  <div className="blob-tool-stack">
                    {showBackground && (
                      <div className="blob-timeline-actions">
                        <button
                          type="button"
                          className="blob-btn"
                          style={{ minHeight: 44 }}
                          onClick={() => pushAndPreview(setBackground(history.present!, "transparent"))}
                        >
                          Clear bg
                        </button>
                        <label className="blob-btn blob-color" style={{ minWidth: 44, minHeight: 44 }}>
                          Bg
                          <input
                            type="color"
                            value={bg === "transparent" ? "#ffffff" : bg}
                            onChange={(e) =>
                              pushAndPreview(setBackground(history.present!, e.target.value as Background))
                            }
                            aria-label="Background color"
                          />
                        </label>
                      </div>
                    )}
                    <AudioInspector
                      doc={history.present}
                      onMuteChange={(mute) => history.live(setMuteSource(history.present!, mute))}
                      onCommit={commitPreview}
                    />
                  </div>
                )}
              </ToolPanel>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default BlobEditor;
