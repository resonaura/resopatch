export interface VariantSpec {
  key: string;
  format: 'webp' | 'avif' | 'png' | 'jpeg';
  width: number | null;
  quality: number | null;
  ext: string;
}

export interface ManifestEntry {
  lqip: string;
  breakpoints: number[];
  intrinsic: { w: number | null; h: number | null };
  /** Content hash, appended to image URLs as a cache-busting query param so a
   * changed source file is fetched fresh instead of served from the browser's
   * long-lived immutable cache under the old, unchanged URL. */
  contentHash: string;
  /** Per-row brightness profile (0 = black, 1 = white), top to bottom. */
  contrastProfile: number[];
}

export type ImageManifest = Record<string, ManifestEntry>;

export interface ResolvedVariant {
  buffer: Buffer;
  mime: string;
  sourceHash: string;
  variantKey: string;
}
