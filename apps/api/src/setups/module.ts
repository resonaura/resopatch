import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/module.js';
import { DatabaseModule } from '../database/module.js';
import { SetupsController } from './controller.js';
import { SetupsService } from './service.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [SetupsController],
  providers: [SetupsService],
  exports: [SetupsService],
})
export class SetupsModule {}
