import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/module.js';
import { DatabaseModule } from '../database/module.js';
import { DevicesController } from './controller.js';
import { DevicesService } from './service.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [DevicesController],
  providers: [DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
