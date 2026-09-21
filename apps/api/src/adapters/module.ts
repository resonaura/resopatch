import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/module.js';
import { DatabaseModule } from '../database/module.js';
import { AdaptersController } from './controller.js';
import { AdaptersService } from './service.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [AdaptersController],
  providers: [AdaptersService],
  exports: [AdaptersService],
})
export class AdaptersModule {}
