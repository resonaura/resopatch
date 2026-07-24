import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { IntrinsicSize, OptimizeOptions, OptimizedAsset } from './types.js';

// WebP hard-caps each dimension at 16383px, and AVIF encoding gets unreasonably slow
// well before that too. A source with an extreme aspect ratio can blow past that on
// the *unconstrained* axis even at a modest requested width, so every breakpoint
// resize is capped on both axes, not just width.
const MAX_OUTPUT_DIMENSION = 16000;

@Injectable()
export class OptimizerService {
  async optimizeRaster(filePath: string, options: OptimizeOptions): Promise<OptimizedAsset> {
    const pipeline = sharp(filePath);

    if (options.width) {
      pipeline.resize({
        width: options.width,
        height: MAX_OUTPUT_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    const format = options.format ?? 'webp';
    const quality = options.quality ?? 80;

    if (format === 'avif') {
      // chromaSubsampling: '4:4:4' keeps full color resolution at sharp edges (text,
      // thin lines) — the default 4:2:0 halves it, which is where lossy compression
      // visibly smears text first, well before luma detail is affected.
      pipeline.avif({ quality, effort: 6, chromaSubsampling: '4:4:4' });
    } else if (format === 'webp') {
      // smartSubsample spends extra encode time finding better chroma placement
      // specifically around sharp edges instead of subsampling uniformly — same
      // goal as AVIF's 4:4:4 above, without doubling chroma data everywhere.
      pipeline.webp({ quality, effort: 6, smartSubsample: true });
    } else if (format === 'png') {
      pipeline.png({ quality, compressionLevel: 8 });
    } else {
      pipeline.jpeg({ quality, mozjpeg: true });
    }

    const buffer = await pipeline.toBuffer();
    return { buffer, mime: `image/${format}` };
  }

  async generateRasterLqip(filePath: string): Promise<string> {
    try {
      const buffer = await sharp(filePath).resize({ width: 20 }).webp({ quality: 20 }).toBuffer();
      return `data:image/webp;base64,${buffer.toString('base64')}`;
    } catch {
      return '';
    }
  }

  async getIntrinsicSize(filePath: string): Promise<IntrinsicSize> {
    try {
      const meta = await sharp(filePath).metadata();
      return { w: meta.width ?? null, h: meta.height ?? null };
    } catch {
      return { w: null, h: null };
    }
  }

  /**
   * Coarse per-row brightness profile (0 = black, 1 = white), computed once at index
   * time. Transparent regions are flattened onto a neutral mid-gray first — that reads
   * as a soft "no strong opinion" for those pixels rather than skewing hard toward
   * black, which raw RGBA of a transparent pixel would otherwise do.
   */
  async computeBrightnessProfile(filePath: string, bands = 32): Promise<number[]> {
    try {
      const { data, info } = await sharp(filePath)
        .flatten({ background: { r: 128, g: 128, b: 128 } })
        .resize({ width: 8, height: bands, fit: 'fill' })
        .raw()
        .toBuffer({ resolveWithObject: true });

      const profile: number[] = [];
      for (let row = 0; row < info.height; row++) {
        let sum = 0;
        for (let col = 0; col < info.width; col++) {
          const idx = (row * info.width + col) * info.channels;
          sum += (0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]) / 255;
        }
        profile.push(sum / info.width);
      }
      return profile;
    } catch {
      return [];
    }
  }
}
