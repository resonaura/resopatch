import { Module } from '@nestjs/common';
import { CacheModule } from '../cache/cache.module';
import { ManifestController } from './manifest.controller';

@Module({
  imports: [CacheModule],
  controllers: [ManifestController],
})
export class ManifestModule {}
