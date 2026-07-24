import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { FurnitureController } from './furniture.controller.js';
import { FurnitureService } from './furniture.service.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [FurnitureController],
  providers: [FurnitureService],
  exports: [FurnitureService],
})
export class FurnitureModule {}
