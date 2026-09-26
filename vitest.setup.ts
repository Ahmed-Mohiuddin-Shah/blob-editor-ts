/**
 * Node encode tests: jsdom's canvas is a stub — back it with `canvas` (node-canvas).
 */
import { createCanvas, Image as CanvasImage } from "canvas";

const origCreate = document.createElement.bind(document);
document.createElement = ((tagName: string, options?: ElementCreationOptions) => {
  if (String(tagName).toLowerCase() === "canvas") {
    const c = createCanvas(300, 150) as unknown as HTMLCanvasElement & {
      toBuffer: (mime?: string) => Buffer;
      toBlob?: typeof HTMLCanvasElement.prototype.toBlob;
    };
    c.toBlob = (cb, type) => {
      const mime = type?.includes("jpeg") ? "image/jpeg" : "image/png";
      const buf = c.toBuffer(mime);
      cb(new Blob([Uint8Array.from(buf)], { type: mime || "image/png" }));
    };
    return c;
  }
  return origCreate(tagName, options);
}) as typeof document.createElement;

// loadPngBytes / data-URL fallback in encode
(globalThis as unknown as { Image: typeof CanvasImage }).Image = CanvasImage;
