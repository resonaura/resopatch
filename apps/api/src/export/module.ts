import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/module.js';
import { SetupsModule } from '../setups/module.js';
import { ExportController } from './controller.js';
import { ExportService } from './service.js';

@Module({
  imports: [AuthModule, SetupsModule],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
