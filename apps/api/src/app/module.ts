import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import fs from 'node:fs';
import path from 'node:path';
import { AdaptersModule } from '../adapters/module.js';
import { AuthModule } from '../auth/module.js';
import { CablesModule } from '../cables/module.js';
import { CacheModule } from '../cache/module.js';
import { DatabaseModule } from '../database/module.js';
import { ImageCacheVariant } from '../database/entities/image-cache-variant.js';
import { ImageSourceFile } from '../database/entities/image-source-file.js';
import { DevicesModule } from '../devices/module.js';
import { ExportModule } from '../export/module.js';
import { FurnitureModule } from '../furniture/module.js';
import { validateImageEnv } from '../images/config.js';
import { ImagesModule } from '../images/module.js';
import { ManifestModule } from '../manifest/module.js';
import { PortsModule } from '../ports/module.js';
import { SetupsModule } from '../setups/module.js';
import { SyncModule } from '../sync/module.js';
import { WatcherModule } from '../watcher/module.js';

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
    SyncModule,
  ],
})
export class AppModule {}
