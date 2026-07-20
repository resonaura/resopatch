import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { AdaptersController } from './adapters.controller';
import { AdaptersService } from './adapters.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [AdaptersController],
  providers: [AdaptersService],
  exports: [AdaptersService],
})
export class AdaptersModule {}
