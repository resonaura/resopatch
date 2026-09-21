import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/module.js';
import { SyncGateway } from './gateway.js';

@Module({
  imports: [AuthModule],
  providers: [SyncGateway],
})
export class SyncModule {}
