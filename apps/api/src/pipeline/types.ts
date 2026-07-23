export type ImageFormat = 'webp' | 'avif' | 'png' | 'jpeg';

export interface OptimizeOptions {
  width?: number;
  format?: ImageFormat;
  quality?: number;
}

export interface OptimizedAsset {
  buffer: Buffer;
  mime: string;
}

export interface IntrinsicSize {
  w: number | null;
  h: number | null;
}
