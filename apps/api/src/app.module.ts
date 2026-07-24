import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import fs from 'node:fs';
import path from 'node:path';
import { AdaptersModule } from './adapters/adapters.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CablesModule } from './cables/cables.module.js';
import { CacheModule } from './cache/cache.module.js';
import { DatabaseModule } from './database/database.module.js';
import { ImageCacheVariant } from './database/entities/image-cache-variant.entity.js';
import { ImageSourceFile } from './database/entities/image-source-file.entity.js';
import { DevicesModule } from './devices/devices.module.js';
import { ExportModule } from './export/export.module.js';
import { FurnitureModule } from './furniture/furniture.module.js';
import { validateImageEnv } from './images/config.js';
import { ImagesModule } from './images/images.module.js';
import { ManifestModule } from './manifest/manifest.module.js';
import { PortsModule } from './ports/ports.module.js';
import { SetupsModule } from './setups/setups.module.js';
import { WatcherModule } from './watcher/watcher.module.js';

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
