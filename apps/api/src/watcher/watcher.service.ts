import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { FSWatcher, watch } from 'chokidar';
import { ImagePipelineConfig } from '../images/config.js';
import { CacheService } from '../cache/cache.service.js';

const HOURLY_MS = 60 * 60 * 1000;

/**
 * Watches the image storage dir for changes and drives cache reconciliation.
 *
 * IMPORTANT: chokidar v4 dropped glob-string support (`watch('**\/*', { cwd })` used
 * to work in v3 but silently emits zero events in v4). The fix is to pass the
 * directory path directly and let chokidar recurse into it natively.
 */
@Injectable()
export class WatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WatcherService.name);
  private watcher: FSWatcher | null = null;
  private readonly storageDir: string;
  public ready = false;

  constructor(
    private readonly cache: CacheService,
    config: ConfigService<ImagePipelineConfig, true>,
  ) {
    this.storageDir = config.get('IMG_STORAGE_DIR', { infer: true });
  }

  async onModuleInit(): Promise<void> {
    this.watcher = watch(this.storageDir, {
      cwd: this.storageDir,
      ignored: /(^|[/\\])\../,
      persistent: true,
      ignoreInitial: false,
    });

    this.watcher
      .on('add', (relativePath) => this.handleUpsert('add', relativePath))
      .on('change', (relativePath) => this.handleUpsert('change', relativePath))
      .on('unlink', (relativePath) => this.handleUnlink(relativePath))
      .on('error', (error) => this.logger.error(`Watcher error: ${(error as Error).message}`))
      .on('ready', () => {
        this.ready = true;
        this.logger.log(`Initial cache warmup complete, watching: ${this.storageDir}`);
        // Prunes cache dirs for files renamed/deleted while the server (and thus this
        // watcher) wasn't running to catch the `unlink` event — don't wait a full hour
        // for the periodic sweep to clean those up.
        this.cache.reconcileAll().catch((error) => this.logger.error(`Startup reconcile sweep failed: ${(error as Error).message}`));
      });
  }

  async onModuleDestroy(): Promise<void> {
    await this.watcher?.close();
  }

  private handleUpsert(event: 'add' | 'change', relativePath: string): void {
    this.logger.log(`fs ${event}: ${relativePath}`);
    this.cache.reconcileSourceFile(relativePath).catch((error) => this.logger.error(`Failed to reconcile ${relativePath}: ${(error as Error).message}`));
  }

  private handleUnlink(relativePath: string): void {
    this.logger.log(`fs unlink: ${relativePath}`);
    this.cache.removeSourceFile(relativePath).catch((error) => this.logger.error(`Failed to remove ${relativePath}: ${(error as Error).message}`));
  }

  /**
   * Defense-in-depth sweep: catches cache files deleted out-of-band (no fs event on
   * the source, e.g. someone rm's a file under .cache/files while the server runs).
   */
  @Interval(HOURLY_MS)
  async periodicSweep(): Promise<void> {
    if (!this.ready) return;
    this.logger.log('Running periodic cache reconciliation sweep');
    await this.cache.reconcileAll();
  }
}
