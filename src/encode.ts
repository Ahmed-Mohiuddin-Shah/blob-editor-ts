export {
  encodeComposition,
  compositionNeedsAnimatedEncode,
  primaryMedia,
} from "./core/encode.js";
export type { EncodePayload, AssetBytesResolver } from "./core/types.js";

export { encodePrint, bytesToPrintResolver } from "./core/print/encode.js";
export {
  combinePdfs,
  combinePngsGrid,
  evenGridDims,
} from "./core/print/combine.js";
export type { CombinePngsGridOptions } from "./core/print/combine.js";
export type {
  PrintEncodeOptions,
  PrintEncodePayload,
  PrintAssetBytesResolver,
  PrintDocument,
} from "./core/print/types.js";
