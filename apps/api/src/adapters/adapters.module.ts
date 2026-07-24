import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { AdaptersController } from './adapters.controller.js';
import { AdaptersService } from './adapters.service.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [AdaptersController],
  providers: [AdaptersService],
  exports: [AdaptersService],
})
export class AdaptersModule {}
