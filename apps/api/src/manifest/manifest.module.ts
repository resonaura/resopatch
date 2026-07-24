import { Module } from '@nestjs/common';
import { CacheModule } from '../cache/cache.module.js';
import { ManifestController } from './manifest.controller.js';

@Module({
  imports: [CacheModule],
  controllers: [ManifestController],
})
export class ManifestModule {}
