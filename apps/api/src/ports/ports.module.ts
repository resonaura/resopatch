import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PortsController } from './ports.controller.js';
import { PortsService } from './ports.service.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [PortsController],
  providers: [PortsService],
  exports: [PortsService],
})
export class PortsModule {}
