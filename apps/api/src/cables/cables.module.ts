import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { CablesController } from './cables.controller';
import { CablesService } from './cables.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [CablesController],
  providers: [CablesService],
  exports: [CablesService],
})
export class CablesModule {}
