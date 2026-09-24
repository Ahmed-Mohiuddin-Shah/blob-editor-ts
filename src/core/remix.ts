import type { CompositionDocument } from "./types.js";

/** Deep-copy document for remix. Same asset_id refs; host owns persistence / parents. */
export function remixDeepCopy(source: CompositionDocument): CompositionDocument {
  return structuredClone(source);
}
