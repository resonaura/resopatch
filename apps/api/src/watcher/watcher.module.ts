import { Module } from '@nestjs/common';
import { CacheModule } from '../cache/cache.module';
import { WatcherService } from './watcher.service';

@Module({
  imports: [CacheModule],
  providers: [WatcherService],
})
export class WatcherModule {}
