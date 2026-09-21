import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/module.js';
import { DatabaseModule } from '../database/module.js';
import { PortsController } from './controller.js';
import { PortsService } from './service.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [PortsController],
  providers: [PortsService],
  exports: [PortsService],
})
export class PortsModule {}
