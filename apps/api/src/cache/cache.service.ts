import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Repository } from 'typeorm';
import { ImagePipelineConfig } from '../images/config';
import { ImageCacheVariant } from '../database/entities/image-cache-variant.entity';
import { ImageSourceFile } from '../database/entities/image-source-file.entity';
import { HasherService } from '../pipeline/hasher.service';
import { OptimizerService } from '../pipeline/optimizer.service';
import { BREAKPOINTS, DEFAULT_QUALITY, RASTER_FORMATS } from './constants';
import { ImageManifest, ResolvedVariant, VariantSpec } from './types';

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

const MIME_BY_FORMAT: Record<string, string> = {
  webp: 'image/webp',
  avif: 'image/avif',
  png: 'image/png',
  jpeg: 'image/jpeg',
};

/**
 * DB-backed cache reconciliation. The image_source_files/image_cache_variants tables are
 * the source of truth for "what should exist"; the .cache/files directory is a derived,
 * disposable artifact that can be partially or fully wiped and self-heals from the DB.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly storageDir: string;
  private readonly cacheFilesDir: string;
  /** Serializes all reconcile/remove/ensureVariant work per relativePath — a watcher
   * event and an in-flight HTTP request can otherwise both see "no row/variant yet"
   * and race to insert the same row, tripping a UNIQUE constraint. */
  private readonly inFlightReconciles = new Map<string, Promise<unknown>>();

  constructor(
    @InjectRepository(ImageSourceFile) private readonly sourceFiles: Repository<ImageSourceFile>,
    @InjectRepository(ImageCacheVariant) private readonly variants: Repository<ImageCacheVariant>,
    private readonly hasher: HasherService,
    private readonly optimizer: OptimizerService,
    config: ConfigService<ImagePipelineConfig, true>,
  ) {
    this.storageDir = config.get('IMG_STORAGE_DIR', { infer: true });
    this.cacheFilesDir = config.get('cacheFilesDir', { infer: true });
  }

  private fullPath(relativePath: string): string {
    return path.join(this.storageDir, relativePath);
  }

  private expectedVariantSpecs(): VariantSpec[] {
    const specs: VariantSpec[] = [];
    for (const width of BREAKPOINTS) {
      for (const format of RASTER_FORMATS) {
        specs.push({
          key: this.hasher.variantKey({ w: width, f: format, q: DEFAULT_QUALITY }),
          format,
          width,
          quality: DEFAULT_QUALITY,
          ext: format,
        });
      }
    }
    return specs;
  }

  private async describeSource(absolutePath: string) {
    const contrastProfile = await this.optimizer.computeBrightnessProfile(absolutePath);
    const intrinsic = await this.optimizer.getIntrinsicSize(absolutePath);
    const lqip = await this.optimizer.generateRasterLqip(absolutePath);
    return { intrinsic, lqip, contrastProfile };
  }

  private async writeVariantFile(fullSourcePath: string, spec: VariantSpec): Promise<Buffer> {
    const result = await this.optimizer.optimizeRaster(fullSourcePath, {
      width: spec.width ?? undefined,
      format: spec.format,
      quality: spec.quality ?? DEFAULT_QUALITY,
    });
    return result.buffer;
  }

  /** Cache files for a source live under a subfolder named after its relativePath,
   * so the whole subfolder can be torn down in one shot when the source is removed. */
  private variantDir(relativePath: string): string {
    return path.join(this.cacheFilesDir, relativePath);
  }

  private async generateVariant(
    sourceFile: ImageSourceFile,
    fullSourcePath: string,
    spec: VariantSpec,
    existingId?: string,
  ): Promise<ImageCacheVariant> {
    const buffer = await this.writeVariantFile(fullSourcePath, spec);
    const safeKey = spec.key.replace(/[^a-z0-9]+/gi, '_');
    const baseFilename = `${sourceFile.contentHash}_${safeKey}.${spec.ext}`;
    const dir = this.variantDir(sourceFile.relativePath);
    const filename = path.join(sourceFile.relativePath, baseFilename);

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, baseFilename), buffer);
    this.logger.log(
      `Wrote variant '${spec.key}' (${spec.format}${spec.width ? `, w${spec.width}` : ''}, ${buffer.length}B) for ${sourceFile.relativePath}`,
    );

    if (existingId) {
      await this.variants.update(existingId, {
        filename,
        sizeBytes: buffer.length,
        sourceContentHash: sourceFile.contentHash,
      });
      return (await this.variants.findOneBy({ id: existingId }))!;
    }

    const variant = this.variants.create({
      sourceFileId: sourceFile.id,
      sourceContentHash: sourceFile.contentHash,
      variantKey: spec.key,
      format: spec.format,
      width: spec.width,
      quality: spec.quality,
      filename,
      sizeBytes: buffer.length,
    });
    return this.variants.save(variant);
  }

  private async generateAllVariants(sourceFile: ImageSourceFile, fullSourcePath: string): Promise<void> {
    const specs = this.expectedVariantSpecs();
    this.logger.log(`Generating ${specs.length} variant(s) for ${sourceFile.relativePath}`);
    for (const spec of specs) {
      await this.generateVariant(sourceFile, fullSourcePath, spec);
    }
  }

  /** Deletes cache files + DB rows for every variant of a source file, tearing down
   * its whole cache subfolder rather than unlinking filenames one by one. */
  private async purgeVariants(sourceFile: ImageSourceFile): Promise<void> {
    this.logger.log(`Purging cache for ${sourceFile.relativePath}`);
    await this.variants.delete({ sourceFileId: sourceFile.id });
    await fs.rm(this.variantDir(sourceFile.relativePath), { recursive: true, force: true });
  }

  /** Runs `fn` for `relativePath` after any in-flight reconcile/remove/ensureVariant
   * call for the same path has settled, and queues later callers behind this one. */
  private async withFileLock<T>(relativePath: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.inFlightReconciles.get(relativePath) ?? Promise.resolve();
    const run = previous.then(fn, fn).finally(() => {
      if (this.inFlightReconciles.get(relativePath) === run) {
        this.inFlightReconciles.delete(relativePath);
      }
    });
    this.inFlightReconciles.set(relativePath, run);
    return run;
  }

  /**
   * Core reconciliation entry point. Idempotent — safe to call repeatedly for the
   * same file (startup warmup, periodic sweep, post-change watcher events, and
   * request-time ensureVariant() lookups all funnel through here). Concurrent calls
   * for the same relativePath are serialized to avoid racing on the same DB row.
   */
  async reconcileSourceFile(relativePath: string): Promise<void> {
    return this.withFileLock(relativePath, () => this.doReconcileSourceFile(relativePath));
  }

  private async doReconcileSourceFile(relativePath: string): Promise<void> {
    const fullSourcePath = this.fullPath(relativePath);
    let stat: { size: number; mtimeMs: number };
    try {
      stat = await this.hasher.stat(fullSourcePath);
    } catch {
      this.logger.warn(`Reconcile skipped, file vanished: ${relativePath}`);
      return; // file vanished between the fs event and this call
    }

    this.logger.log(`Reconciling ${relativePath}`);
    const row = await this.sourceFiles.findOne({ where: { relativePath } });

    const hash =
      row && row.size === stat.size && row.mtimeMs === stat.mtimeMs ? row.contentHash : await this.hasher.hashContent(fullSourcePath);

    if (!row) {
      const { intrinsic, lqip, contrastProfile } = await this.describeSource(fullSourcePath);
      const created = await this.sourceFiles.save(
        this.sourceFiles.create({
          relativePath,
          contentHash: hash,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          width: intrinsic.w,
          height: intrinsic.h,
          lqip,
          contrastProfile,
        }),
      );
      this.logger.log(`Indexed new file: ${relativePath}`);
      await this.generateAllVariants(created, fullSourcePath);
      return;
    }

    if (hash !== row.contentHash) {
      this.logger.log(`Content changed, invalidating cache: ${relativePath}`);
      await this.purgeVariants(row);
      const { intrinsic, lqip, contrastProfile } = await this.describeSource(fullSourcePath);
      row.contentHash = hash;
      row.size = stat.size;
      row.mtimeMs = stat.mtimeMs;
      row.width = intrinsic.w;
      row.height = intrinsic.h;
      row.lqip = lqip;
      row.contrastProfile = contrastProfile;
      await this.sourceFiles.save(row);
      await this.generateAllVariants(row, fullSourcePath);
      return;
    }

    // Backfills contrastProfile for rows indexed before it existed.
    if (row.contrastProfile == null) {
      row.contrastProfile = await this.optimizer.computeBrightnessProfile(fullSourcePath);
      await this.sourceFiles.save(row);
    }

    // Hash matches what's on record — only patch what's actually missing on disk.
    const specs = this.expectedVariantSpecs();
    const existing = await this.variants.find({ where: { sourceFileId: row.id } });
    const existingByKey = new Map(existing.map((v) => [v.variantKey, v]));

    let restored = 0;
    for (const spec of specs) {
      const existingRow = existingByKey.get(spec.key);
      if (existingRow) {
        const onDisk = await fileExists(path.join(this.cacheFilesDir, existingRow.filename));
        if (onDisk) continue;
        await this.generateVariant(row, fullSourcePath, spec, existingRow.id);
        restored++;
        this.logger.log(`Restored missing cache variant '${spec.key}' for ${relativePath}`);
      } else {
        await this.generateVariant(row, fullSourcePath, spec);
        restored++;
      }
    }
    if (restored === 0) {
      this.logger.log(`Unchanged, all ${specs.length} variant(s) already cached: ${relativePath}`);
    }
  }

  async removeSourceFile(relativePath: string): Promise<void> {
    return this.withFileLock(relativePath, async () => {
      const row = await this.sourceFiles.findOne({ where: { relativePath } });
      if (!row) return;
      await this.purgeVariants(row);
      await this.sourceFiles.delete({ id: row.id });
      this.logger.log(`Removed from index: ${relativePath}`);
    });
  }

  /** Re-checks every known source file (catches out-of-band cache-file deletions with
   * no fs event), then prunes any cache dir left behind by a source file that's gone. */
  async reconcileAll(): Promise<void> {
    const rows = await this.sourceFiles.find();
    for (const row of rows) {
      await this.reconcileSourceFile(row.relativePath);
    }
    await this.pruneOrphanedCacheDirs();
  }

  /** Recursively finds cache-file leaf directories — the per-source subfolders
   * created by variantDir(), one level deeper than intermediate path segments. */
  private async listLeafCacheDirs(dir: string): Promise<string[]> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const subdirs = entries.filter((e) => e.isDirectory());
    if (subdirs.length === 0) {
      return dir === this.cacheFilesDir ? [] : [dir];
    }
    const leaves: string[] = [];
    for (const sub of subdirs) {
      leaves.push(...(await this.listLeafCacheDirs(path.join(dir, sub.name))));
    }
    return leaves;
  }

  /**
   * Removes cache subfolders that don't correspond to any known source file — e.g. a
   * file renamed/deleted while the server (and its fs watcher) wasn't running, so no
   * `unlink` event ever fired to trigger removeSourceFile's cleanup.
   */
  private async pruneOrphanedCacheDirs(): Promise<void> {
    const known = new Set((await this.sourceFiles.find()).map((r) => r.relativePath));
    const leaves = await this.listLeafCacheDirs(this.cacheFilesDir);
    for (const dir of leaves) {
      const relativePath = path.relative(this.cacheFilesDir, dir);
      if (!known.has(relativePath)) {
        this.logger.log(`Pruning orphaned cache dir (no matching source file): ${relativePath}`);
        await fs.rm(dir, { recursive: true, force: true });
      }
    }
  }

  async getManifest(): Promise<ImageManifest> {
    const rows = await this.sourceFiles.find();
    const manifest: ImageManifest = {};
    for (const row of rows) {
      manifest[row.relativePath] = {
        lqip: row.lqip,
        breakpoints: [...BREAKPOINTS],
        intrinsic: { w: row.width, h: row.height },
        contentHash: row.contentHash,
        contrastProfile: row.contrastProfile ?? [],
      };
    }
    return manifest;
  }

  /**
   * Request-time resolution used by ImagesController. Serves an existing cache hit,
   * self-heals a DB row whose file went missing, or generates + indexes a brand-new
   * variant (e.g. a custom width outside the precomputed breakpoint set).
   */
  async ensureVariant(relativePath: string, request: { width?: number; format?: 'webp' | 'avif' | 'png' | 'jpeg'; quality?: number }): Promise<ResolvedVariant> {
    const fullSourcePath = this.fullPath(relativePath);
    await fs.access(fullSourcePath);

    // Shares the same per-path lock as reconcileSourceFile/removeSourceFile, so a
    // request landing mid-reconcile can't race the watcher to insert the same
    // image_cache_variants row. Calls doReconcileSourceFile (not the public,
    // lock-taking wrapper) below to avoid deadlocking on its own lock re-entrantly.
    return this.withFileLock(relativePath, async () => {
      let row = await this.sourceFiles.findOne({ where: { relativePath } });
      if (!row) {
        await this.doReconcileSourceFile(relativePath);
        row = await this.sourceFiles.findOne({ where: { relativePath } });
        if (!row) throw new Error(`Failed to index ${relativePath}`);
      }

      const spec: VariantSpec = {
        key: this.hasher.variantKey({ w: request.width, f: request.format, q: request.quality ?? DEFAULT_QUALITY }),
        format: request.format ?? 'webp',
        width: request.width ?? null,
        quality: request.quality ?? DEFAULT_QUALITY,
        ext: request.format ?? 'webp',
      };

      let variant = await this.variants.findOne({ where: { sourceFileId: row.id, variantKey: spec.key } });
      if (variant) {
        const filePath = path.join(this.cacheFilesDir, variant.filename);
        if (await fileExists(filePath)) {
          this.logger.debug(`Cache hit '${spec.key}' for ${relativePath}`);
          return {
            buffer: await fs.readFile(filePath),
            mime: MIME_BY_FORMAT[variant.format],
            sourceHash: row.contentHash,
            variantKey: variant.variantKey,
          };
        }
      }

      this.logger.log(`Cache miss '${spec.key}' for ${relativePath}, generating on request`);
      variant = await this.generateVariant(row, fullSourcePath, spec, variant?.id);
      const filePath = path.join(this.cacheFilesDir, variant.filename);
      return {
        buffer: await fs.readFile(filePath),
        mime: MIME_BY_FORMAT[variant.format],
        sourceHash: row.contentHash,
        variantKey: variant.variantKey,
      };
    });
  }
}
