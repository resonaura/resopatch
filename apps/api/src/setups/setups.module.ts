import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { SetupsController } from './setups.controller.js';
import { SetupsService } from './setups.service.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [SetupsController],
  providers: [SetupsService],
  exports: [SetupsService],
})
export class SetupsModule {}
