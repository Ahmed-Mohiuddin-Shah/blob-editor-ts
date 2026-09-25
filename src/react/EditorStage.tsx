import { useCallback, useEffect, useRef, useState } from "react";
import { Stage, Layer, Group, Image as KonvaImage, Text as KonvaText, Rect, Line, Circle } from "react-konva";
import type Konva from "konva";
import type { CompositionDocument, CompositionObject, TextObject } from "../core/types.js";
import { CANVAS_SIZE } from "../core/types.js";
import { updateTransform, updateText } from "../core/ops.js";
import { MEME_FONT_STACK } from "../core/fonts.js";
import { mapCompToSource } from "../core/timing.js";

export type MaskToolMode = "add" | "remove" | "polygon" | null;

export interface EditorStageProps {
  doc: CompositionDocument;
  images: Record<string, HTMLImageElement | HTMLVideoElement | HTMLCanvasElement>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onDocumentChange: (doc: CompositionDocument) => void;
  onInteractionEnd?: () => void;
  width: number;
  height: number;
  playheadMs?: number;
  /** Brush add/remove or polygon point capture — disables drag. */
  maskMode?: MaskToolMode;
  /** Canvas-space brush radius for paint + cursor preview. */
  brushSize?: number;
  onBrushPaint?: (canvasX: number, canvasY: number) => void;
  polygonPoints?: { x: number; y: number }[];
  onPolygonPoint?: (canvasX: number, canvasY: number) => void;
}

function mediaSize(image?: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement): { w: number; h: number } {
  if (!image) return { w: 0, h: 0 };
  if (image instanceof HTMLVideoElement) return { w: image.videoWidth, h: image.videoHeight };
  if (image instanceof HTMLCanvasElement) return { w: image.width, h: image.height };
  return { w: image.naturalWidth, h: image.naturalHeight };
}

/** Compose crop + optional mask so the stage matches renderExports. */
function composeStageLayer(
  src: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  crop: { x: number; y: number; width: number; height: number } | null | undefined,
  mask: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | null | undefined,
  cache: HTMLCanvasElement,
): HTMLCanvasElement {
  const nat = mediaSize(src);
  const sw = Math.max(1, Math.round(crop?.width ?? nat.w));
  const sh = Math.max(1, Math.round(crop?.height ?? nat.h));
  const sx = crop?.x ?? 0;
  const sy = crop?.y ?? 0;
  if (cache.width !== sw || cache.height !== sh) {
    cache.width = sw;
    cache.height = sh;
  }
  const ctx = cache.getContext("2d")!;
  ctx.clearRect(0, 0, sw, sh);
  ctx.globalCompositeOperation = "source-over";
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  if (mask) {
    // Match render.ts rasterizeMediaLayer: stretch mask into crop layer.
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(mask, 0, 0, sw, sh);
    ctx.globalCompositeOperation = "source-over";
  }
  return cache;
}

/** Snapshot video (or pass-through / masked image) so Konva always has a paintable bitmap. */
function useStageBitmaps(
  doc: CompositionDocument,
  images: Record<string, HTMLImageElement | HTMLVideoElement | HTMLCanvasElement>,
  tMs: number,
): Record<string, HTMLImageElement | HTMLCanvasElement> {
  const [bitmaps, setBitmaps] = useState<Record<string, HTMLImageElement | HTMLCanvasElement>>({});
  const canvasCache = useRef<Record<string, HTMLCanvasElement>>({});

  useEffect(() => {
    let cancelled = false;

    async function sync() {
      const next: Record<string, HTMLImageElement | HTMLCanvasElement> = {};
      for (const obj of doc.objects) {
        if (obj.type !== "media") continue;
        const src = images[obj.asset_id];
        if (!src) continue;

        let base: HTMLImageElement | HTMLCanvasElement;
        if (src instanceof HTMLVideoElement) {
          const sourceT = obj.keep ? mapCompToSource(obj.keep, tMs) : tMs;
          if (sourceT != null) {
            const sec = sourceT / 1000;
            if (Math.abs(src.currentTime - sec) > 0.04) {
              await new Promise<void>((res) => {
                const done = () => {
                  src.removeEventListener("seeked", done);
                  res();
                };
                src.addEventListener("seeked", done);
                src.currentTime = sec;
                setTimeout(done, 120);
              });
            }
          }
          if (cancelled) return;
          let c = canvasCache.current[obj.asset_id];
          if (!c) {
            c = document.createElement("canvas");
            canvasCache.current[obj.asset_id] = c;
          }
          const w = src.videoWidth || 1;
          const h = src.videoHeight || 1;
          if (c.width !== w || c.height !== h) {
            c.width = w;
            c.height = h;
          }
          const ctx = c.getContext("2d");
          if (ctx) ctx.drawImage(src, 0, 0, w, h);
          base = c;
        } else {
          base = src;
        }

        const mask =
          obj.kind === "image" && obj.mask_asset_id ? images[obj.mask_asset_id] : null;
        if (mask || obj.crop) {
          const key = `${obj.id}:layer`;
          let layer = canvasCache.current[key];
          if (!layer) {
            layer = document.createElement("canvas");
            canvasCache.current[key] = layer;
          }
          // ponytail: mutate cache canvas — force Konva refresh via new object identity when mask pixels change
          const stamped = document.createElement("canvas");
          composeStageLayer(base, obj.crop, mask ?? null, layer);
          stamped.width = layer.width;
          stamped.height = layer.height;
          stamped.getContext("2d")!.drawImage(layer, 0, 0);
          next[obj.asset_id] = stamped;
          next[`${obj.id}:composed`] = stamped;
        } else {
          next[obj.asset_id] = base;
        }
      }
      for (const [id, src] of Object.entries(images)) {
        if (next[id]) continue;
        if (src instanceof HTMLVideoElement) continue;
        next[id] = src;
      }
      if (!cancelled) setBitmaps(next);
    }

    void sync();
    return () => {
      cancelled = true;
    };
  }, [doc, images, tMs]);

  return bitmaps;
}

function MediaNode({
  obj,
  image,
  composed,
  selected,
  onSelect,
  onChange,
  onInteractionEnd,
  visible,
  interactive,
}: {
  obj: Extract<CompositionObject, { type: "media" }>;
  image?: HTMLImageElement | HTMLCanvasElement;
  /** When true, `image` is already crop+mask sized — skip Konva crop. */
  composed?: boolean;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<CompositionDocument["objects"][0]["transform"]>) => void;
  onInteractionEnd?: () => void;
  visible: boolean;
  interactive: boolean;
}) {
  if (!visible || !image) return null;
  const crop = composed ? undefined : obj.crop;
  const nat = mediaSize(image);
  const iw = crop?.width ?? nat.w;
  const ih = crop?.height ?? nat.h;
  if (iw <= 0 || ih <= 0) return null;

  return (
    <KonvaImage
      id={obj.id}
      name={obj.id}
      image={image}
      x={obj.transform.x}
      y={obj.transform.y}
      offsetX={iw / 2}
      offsetY={ih / 2}
      scaleX={obj.transform.scale_x}
      scaleY={obj.transform.scale_y}
      rotation={obj.transform.rotation}
      crop={crop ? { x: crop.x, y: crop.y, width: crop.width, height: crop.height } : undefined}
      draggable={interactive}
      listening={interactive}
      stroke={selected ? "#f10ea0" : undefined}
      strokeWidth={selected ? 4 / Math.max(obj.transform.scale_x, 0.01) : 0}
      onClick={interactive ? onSelect : undefined}
      onTap={interactive ? onSelect : undefined}
      onDragEnd={(e) => {
        onChange({ x: e.target.x(), y: e.target.y() });
        onInteractionEnd?.();
      }}
    />
  );
}

function TextNode({
  obj,
  selected,
  onSelect,
  onChange,
  onEditRequest,
  onInteractionEnd,
  visible,
  interactive,
}: {
  obj: TextObject;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<CompositionDocument["objects"][0]["transform"]>) => void;
  onEditRequest: () => void;
  onInteractionEnd?: () => void;
  visible: boolean;
  interactive: boolean;
}) {
  if (!visible) return null;
  return (
    <KonvaText
      id={obj.id}
      name={obj.id}
      text={obj.text}
      fontFamily={obj.font === "Impact" || obj.font === "Anton" ? MEME_FONT_STACK : obj.font}
      fontSize={obj.font_size}
      fill={obj.style.fill}
      stroke={obj.style.stroke}
      strokeWidth={obj.style.stroke_width}
      x={obj.transform.x}
      y={obj.transform.y}
      scaleX={obj.transform.scale_x}
      scaleY={obj.transform.scale_y}
      rotation={obj.transform.rotation}
      align="center"
      verticalAlign="middle"
      draggable={interactive}
      listening={interactive}
      opacity={selected ? 1 : 0.95}
      onClick={interactive ? onSelect : undefined}
      onTap={interactive ? onSelect : undefined}
      onDblClick={interactive ? onEditRequest : undefined}
      onDblTap={interactive ? onEditRequest : undefined}
      onDragEnd={(e) => {
        onChange({ x: e.target.x(), y: e.target.y() });
        onInteractionEnd?.();
      }}
    />
  );
}

function canvasPos(stage: Konva.Stage | null, displayScale: number): { x: number; y: number } | null {
  const pos = stage?.getPointerPosition();
  if (!pos) return null;
  return { x: pos.x / displayScale, y: pos.y / displayScale };
}

export function EditorStage({
  doc,
  images,
  selectedId,
  onSelect,
  onDocumentChange,
  onInteractionEnd,
  width,
  height,
  playheadMs = 0,
  maskMode = null,
  brushSize = 28,
  onBrushPaint,
  polygonPoints = [],
  onPolygonPoint,
}: EditorStageProps) {
  const side = Math.min(width, height);
  const scale = side / CANVAS_SIZE;
  const t = doc.duration_ms > 0 ? playheadMs : 0;
  const bitmaps = useStageBitmaps(doc, images, t);
  const layerRef = useRef<Konva.Layer>(null);
  const painting = useRef(false);
  const [rubber, setRubber] = useState<{ x: number; y: number } | null>(null);
  const [brushCursor, setBrushCursor] = useState<{ x: number; y: number } | null>(null);
  const masking = maskMode != null;
  const brushing = maskMode === "add" || maskMode === "remove";
  const interactive = !masking;

  useEffect(() => {
    layerRef.current?.batchDraw();
  }, [bitmaps, t, doc, selectedId, polygonPoints, rubber, brushCursor, maskMode, brushSize]);

  const patchTransform = useCallback(
    (id: string, patch: Partial<CompositionDocument["objects"][0]["transform"]>) => {
      onDocumentChange(updateTransform(doc, id, patch));
    },
    [doc, onDocumentChange],
  );

  const bg = doc.canvas.background === "transparent" ? undefined : doc.canvas.background;

  const paintAt = (stage: Konva.Stage | null) => {
    if (!brushing || !onBrushPaint) return;
    const p = canvasPos(stage, scale);
    if (p) onBrushPaint(p.x, p.y);
  };

  const endPaint = () => {
    if (painting.current) {
      painting.current = false;
      onInteractionEnd?.();
    }
  };

  // Closed polygon: points + optional rubber-band, always close back to first when ≥3.
  const polyClosed = polygonPoints.length >= 3;
  const flatPts = polygonPoints.flatMap((p) => [p.x, p.y]);
  if (rubber && polygonPoints.length > 0) {
    flatPts.push(rubber.x, rubber.y);
  }

  return (
    <div
      className={`blob-stage-clip${masking ? " is-masking" : ""}`}
      style={{ width: side, height: side }}
    >
      <Stage
        width={side}
        height={side}
        scaleX={scale}
        scaleY={scale}
        onMouseDown={(e) => {
          const stage = e.target.getStage();
          if (maskMode === "polygon" && onPolygonPoint) {
            const p = canvasPos(stage, scale);
            if (p) onPolygonPoint(p.x, p.y);
            return;
          }
          if (brushing && onBrushPaint) {
            painting.current = true;
            paintAt(stage);
            return;
          }
          if (e.target === stage) onSelect(null);
        }}
        onMouseMove={(e) => {
          const stage = e.target.getStage();
          const p = canvasPos(stage, scale);
          if (maskMode === "polygon") {
            setRubber(p);
            setBrushCursor(null);
            return;
          }
          if (brushing) {
            setBrushCursor(p);
            if (painting.current) paintAt(stage);
            return;
          }
          setBrushCursor(null);
        }}
        onMouseUp={endPaint}
        onMouseLeave={() => {
          endPaint();
          setRubber(null);
          setBrushCursor(null);
        }}
        onTouchStart={(e) => {
          const stage = e.target.getStage();
          if (maskMode === "polygon" && onPolygonPoint) {
            const p = canvasPos(stage, scale);
            if (p) onPolygonPoint(p.x, p.y);
            return;
          }
          if (brushing && onBrushPaint) {
            painting.current = true;
            const p = canvasPos(stage, scale);
            setBrushCursor(p);
            paintAt(stage);
            return;
          }
          if (e.target === stage) onSelect(null);
        }}
        onTouchMove={(e) => {
          const stage = e.target.getStage();
          const p = canvasPos(stage, scale);
          if (maskMode === "polygon") {
            setRubber(p);
            return;
          }
          if (brushing) {
            setBrushCursor(p);
            if (painting.current) {
              e.evt.preventDefault();
              paintAt(stage);
            }
          }
        }}
        onTouchEnd={endPaint}
        style={{ touchAction: "none", display: "block" }}
      >
        <Layer ref={layerRef}>
          <Group
            clipFunc={(ctx) => {
              ctx.rect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
            }}
          >
            <Rect
              name="canvas-bg"
              width={CANVAS_SIZE}
              height={CANVAS_SIZE}
              fill={bg ?? "rgba(0,0,0,0.03)"}
              listening={!masking}
              onMouseDown={() => interactive && onSelect(null)}
              onTouchStart={() => interactive && onSelect(null)}
            />
            {doc.objects.map((obj) => {
              if (obj.type === "media") {
                const visible = !obj.keep || mapCompToSource(obj.keep, t) != null;
                const composed = !!(obj.crop || (obj.kind === "image" && obj.mask_asset_id));
                return (
                  <MediaNode
                    key={obj.id}
                    obj={obj}
                    image={bitmaps[`${obj.id}:composed`] ?? bitmaps[obj.asset_id]}
                    composed={composed}
                    selected={selectedId === obj.id}
                    onSelect={() => onSelect(obj.id)}
                    onChange={(p) => patchTransform(obj.id, p)}
                    onInteractionEnd={onInteractionEnd}
                    visible={visible}
                    interactive={interactive}
                  />
                );
              }
              return (
                <TextNode
                  key={obj.id}
                  obj={obj}
                  selected={selectedId === obj.id}
                  onSelect={() => onSelect(obj.id)}
                  onChange={(p) => patchTransform(obj.id, p)}
                  onInteractionEnd={onInteractionEnd}
                  visible
                  interactive={interactive}
                  onEditRequest={() => {
                    const next = window.prompt("Text", obj.text);
                    if (next != null) {
                      onDocumentChange(updateText(doc, obj.id, { text: next }));
                      onInteractionEnd?.();
                    }
                  }}
                />
              );
            })}
            {maskMode === "polygon" && flatPts.length >= 2 && (
              <Line
                points={flatPts}
                stroke="#f10ea0"
                strokeWidth={2}
                closed={polyClosed}
                listening={false}
              />
            )}
            {maskMode === "polygon" &&
              polygonPoints.map((p, i) => (
                <Circle
                  key={i}
                  x={p.x}
                  y={p.y}
                  radius={5}
                  fill="#f10ea0"
                  listening={false}
                />
              ))}
            {brushing && brushCursor && (
              <Circle
                x={brushCursor.x}
                y={brushCursor.y}
                radius={brushSize}
                stroke="#f10ea0"
                strokeWidth={2}
                dash={[6, 4]}
                listening={false}
              />
            )}
          </Group>
        </Layer>
      </Stage>
    </div>
  );
}
