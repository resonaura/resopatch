import { Module } from '@nestjs/common';
import { CacheModule } from '../cache/module.js';
import { ManifestController } from './controller.js';

@Module({
  imports: [CacheModule],
  controllers: [ManifestController],
})
export class ManifestModule {}
