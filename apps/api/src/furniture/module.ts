import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/module.js';
import { DatabaseModule } from '../database/module.js';
import { FurnitureController } from './controller.js';
import { FurnitureService } from './service.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [FurnitureController],
  providers: [FurnitureService],
  exports: [FurnitureService],
})
export class FurnitureModule {}
