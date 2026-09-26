declare module "gifenc" {
  export function GIFEncoder(opts?: object): {
    writeFrame: (index: Uint8Array, w: number, h: number, opts?: object) => void;
    finish: () => void;
    bytes: () => Uint8Array;
  };
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, opts?: object): number[][];
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: number[][],
    format?: string,
  ): Uint8Array;
  export default GIFEncoder;
}
