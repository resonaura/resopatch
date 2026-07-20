import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { FurnitureController } from './furniture.controller';
import { FurnitureService } from './furniture.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [FurnitureController],
  providers: [FurnitureService],
  exports: [FurnitureService],
})
export class FurnitureModule {}
