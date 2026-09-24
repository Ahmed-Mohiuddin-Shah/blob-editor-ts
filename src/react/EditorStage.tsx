import { useCallback } from "react";
import { Stage, Layer, Group, Image as KonvaImage, Text as KonvaText, Rect } from "react-konva";
import type { CompositionDocument, CompositionObject, TextObject } from "../core/types.js";
import { CANVAS_SIZE } from "../core/types.js";
import { updateTransform, updateText } from "../core/ops.js";
import { MEME_FONT_STACK } from "../core/fonts.js";

export interface EditorStageProps {
  doc: CompositionDocument;
  images: Record<string, HTMLImageElement>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onDocumentChange: (doc: CompositionDocument) => void;
  /** Fires after drag ends — host should refresh export previews. */
  onInteractionEnd?: () => void;
  /** Content square size in CSS pixels. */
  width: number;
  height: number;
}

function MediaNode({
  obj,
  image,
  selected,
  onSelect,
  onChange,
  onInteractionEnd,
}: {
  obj: Extract<CompositionObject, { type: "media" }>;
  image?: HTMLImageElement;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<CompositionDocument["objects"][0]["transform"]>) => void;
  onInteractionEnd?: () => void;
}) {
  const crop = obj.crop;
  const iw = crop?.width ?? image?.naturalWidth ?? 0;
  const ih = crop?.height ?? image?.naturalHeight ?? 0;

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
      draggable
      stroke={selected ? "#f10ea0" : undefined}
      strokeWidth={selected ? 4 / Math.max(obj.transform.scale_x, 0.01) : 0}
      onClick={onSelect}
      onTap={onSelect}
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
}: {
  obj: TextObject;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<CompositionDocument["objects"][0]["transform"]>) => void;
  onEditRequest: () => void;
  onInteractionEnd?: () => void;
}) {
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
      draggable
      opacity={selected ? 1 : 0.95}
      onClick={onSelect}
      onTap={onSelect}
      onDblClick={onEditRequest}
      onDblTap={onEditRequest}
      onDragEnd={(e) => {
        onChange({ x: e.target.x(), y: e.target.y() });
        onInteractionEnd?.();
      }}
    />
  );
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
}: EditorStageProps) {
  const side = Math.min(width, height);
  const scale = side / CANVAS_SIZE;

  const patchTransform = useCallback(
    (id: string, patch: Partial<CompositionDocument["objects"][0]["transform"]>) => {
      onDocumentChange(updateTransform(doc, id, patch));
    },
    [doc, onDocumentChange],
  );

  const bg = doc.canvas.background === "transparent" ? undefined : doc.canvas.background;

  return (
    <div className="blob-stage-clip" style={{ width: side, height: side }}>
      <Stage
        width={side}
        height={side}
        scaleX={scale}
        scaleY={scale}
        onMouseDown={(e) => {
          if (e.target === e.target.getStage()) onSelect(null);
        }}
        onTouchStart={(e) => {
          if (e.target === e.target.getStage()) onSelect(null);
        }}
        style={{ touchAction: "none", display: "block" }}
      >
        <Layer>
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
              listening
              onMouseDown={() => onSelect(null)}
              onTouchStart={() => onSelect(null)}
            />
            {doc.objects.map((obj) => {
              if (obj.type === "media") {
                return (
                  <MediaNode
                    key={obj.id}
                    obj={obj}
                    image={images[obj.asset_id]}
                    selected={selectedId === obj.id}
                    onSelect={() => onSelect(obj.id)}
                    onChange={(p) => patchTransform(obj.id, p)}
                    onInteractionEnd={onInteractionEnd}
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
          </Group>
        </Layer>
      </Stage>
    </div>
  );
}
