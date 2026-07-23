import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ImageCacheVariant } from '../database/entities/image-cache-variant.entity';
import { ImageSourceFile } from '../database/entities/image-source-file.entity';
import { OptimizerService } from '../pipeline/optimizer.service';
import { HasherService } from '../pipeline/hasher.service';
import { CacheService } from './cache.service';

@Module({
  imports: [TypeOrmModule.forFeature([ImageSourceFile, ImageCacheVariant])],
  providers: [CacheService, HasherService, OptimizerService],
  exports: [CacheService],
})
export class CacheModule {}
