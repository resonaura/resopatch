import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import fs from 'node:fs';
import path from 'node:path';
import { AdaptersModule } from './adapters/adapters.module';
import { AuthModule } from './auth/auth.module';
import { CablesModule } from './cables/cables.module';
import { CacheModule } from './cache/cache.module';
import { DatabaseModule } from './database/database.module';
import { ImageCacheVariant } from './database/entities/image-cache-variant.entity';
import { ImageSourceFile } from './database/entities/image-source-file.entity';
import { DevicesModule } from './devices/devices.module';
import { ExportModule } from './export/export.module';
import { FurnitureModule } from './furniture/furniture.module';
import { validateImageEnv } from './images/config';
import { ImagesModule } from './images/images.module';
import { ManifestModule } from './manifest/manifest.module';
import { PortsModule } from './ports/ports.module';
import { SetupsModule } from './setups/setups.module';
import { WatcherModule } from './watcher/watcher.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateImageEnv }),
    ScheduleModule.forRoot(),
    // Dedicated sqlite db for the image variant cache index — separate from the app's
    // json-db (see database/json-db.ts), which stays the source of truth for setups/
    // devices/etc. This one is a disposable, self-healing index the cache pipeline
    // rebuilds from whatever's on disk under storage/.
    TypeOrmModule.forRootAsync({
      useFactory: () => {
        const config = validateImageEnv(process.env);
        fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
        return {
          type: 'better-sqlite3' as const,
          database: config.dbPath,
          entities: [ImageSourceFile, ImageCacheVariant],
          synchronize: true,
        };
      },
    }),
    DatabaseModule,
    AuthModule,
    SetupsModule,
    DevicesModule,
    PortsModule,
    AdaptersModule,
    CablesModule,
    FurnitureModule,
    ExportModule,
    CacheModule,
    WatcherModule,
    ImagesModule,
    ManifestModule,
  ],
})
export class AppModule {}
