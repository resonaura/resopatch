import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/module.js';
import { DatabaseModule } from '../database/module.js';
import { CablesController } from './controller.js';
import { CablesService } from './service.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [CablesController],
  providers: [CablesService],
  exports: [CablesService],
})
export class CablesModule {}
