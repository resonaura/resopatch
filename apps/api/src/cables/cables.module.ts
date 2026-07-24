import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { CablesController } from './cables.controller.js';
import { CablesService } from './cables.service.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [CablesController],
  providers: [CablesService],
  exports: [CablesService],
})
export class CablesModule {}
