import { Module } from '@nestjs/common';
import { CacheModule } from '../cache/cache.module.js';
import { WatcherService } from './watcher.service.js';

@Module({
  imports: [CacheModule],
  providers: [WatcherService],
})
export class WatcherModule {}
