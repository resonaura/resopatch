import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SetupsModule } from '../setups/setups.module.js';
import { ExportController } from './export.controller.js';
import { ExportService } from './export.service.js';

@Module({
  imports: [AuthModule, SetupsModule],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
