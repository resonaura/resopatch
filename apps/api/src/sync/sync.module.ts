import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SyncGateway } from './sync.gateway.js';

@Module({
  imports: [AuthModule],
  providers: [SyncGateway],
})
export class SyncModule {}
