import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { PortsController } from './ports.controller';
import { PortsService } from './ports.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [PortsController],
  providers: [PortsService],
  exports: [PortsService],
})
export class PortsModule {}
