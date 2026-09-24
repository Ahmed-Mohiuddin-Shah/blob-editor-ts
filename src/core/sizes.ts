/** Locked export / preview sizes — preview ≡ export. */

export const EXPORT_SIZES = {
  chat: 128,
  thumbnail: 256,
  full: 1024,
} as const;

export type ExportSizeName = keyof typeof EXPORT_SIZES;
