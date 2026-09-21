import { Module } from '@nestjs/common';
import { CacheModule } from '../cache/module.js';
import { WatcherService } from './service.js';

@Module({
  imports: [CacheModule],
  providers: [WatcherService],
})
export class WatcherModule {}
