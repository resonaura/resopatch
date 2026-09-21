export interface ImageManifestEntry {
  lqip: string;
  breakpoints: number[];
  intrinsic: { w: number | null; h: number | null };
  /** Appended to image URLs as a cache-busting query param so a changed source
   * file is fetched fresh instead of served from the browser's long-lived
   * immutable cache under the old, unchanged URL. */
  contentHash: string;
  contrastProfile: number[];
}

export interface ImageManifest {
  [filePath: string]: ImageManifestEntry;
}
