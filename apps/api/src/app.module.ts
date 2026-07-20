import { Module } from '@nestjs/common';
import { AdaptersModule } from './adapters/adapters.module';
import { AuthModule } from './auth/auth.module';
import { CablesModule } from './cables/cables.module';
import { DatabaseModule } from './database/database.module';
import { DevicesModule } from './devices/devices.module';
import { ExportModule } from './export/export.module';
import { FurnitureModule } from './furniture/furniture.module';
import { PortsModule } from './ports/ports.module';
import { SetupsModule } from './setups/setups.module';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    SetupsModule,
    DevicesModule,
    PortsModule,
    AdaptersModule,
    CablesModule,
    FurnitureModule,
    ExportModule,
  ],
})
export class AppModule {}
