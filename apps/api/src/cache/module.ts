import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ImageCacheVariant } from '../database/entities/image-cache-variant.js';
import { ImageSourceFile } from '../database/entities/image-source-file.js';
import { OptimizerService } from '../pipeline/optimizer.js';
import { HasherService } from '../pipeline/hasher.js';
import { CacheService } from './service.js';

@Module({
  imports: [TypeOrmModule.forFeature([ImageSourceFile, ImageCacheVariant])],
  providers: [CacheService, HasherService, OptimizerService],
  exports: [CacheService],
})
export class CacheModule {}
