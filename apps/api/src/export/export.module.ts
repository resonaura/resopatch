import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SetupsModule } from '../setups/setups.module';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';

@Module({
  imports: [AuthModule, SetupsModule],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
