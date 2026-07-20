import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { SetupsController } from './setups.controller';
import { SetupsService } from './setups.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [SetupsController],
  providers: [SetupsService],
  exports: [SetupsService],
})
export class SetupsModule {}
