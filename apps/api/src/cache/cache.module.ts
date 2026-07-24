import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ImageCacheVariant } from '../database/entities/image-cache-variant.entity.js';
import { ImageSourceFile } from '../database/entities/image-source-file.entity.js';
import { OptimizerService } from '../pipeline/optimizer.service.js';
import { HasherService } from '../pipeline/hasher.service.js';
import { CacheService } from './cache.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([ImageSourceFile, ImageCacheVariant])],
  providers: [CacheService, HasherService, OptimizerService],
  exports: [CacheService],
})
export class CacheModule {}
