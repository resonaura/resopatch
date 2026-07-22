import { Module } from '@nestjs/common';

// Persistence now lives in `json-db.ts` (module-level singleton repositories imported directly
// by each service) instead of TypeORM — see that file's docstring. This module is kept as an
// empty shell so every feature module can keep importing `DatabaseModule` unchanged.
@Module({})
export class DatabaseModule {}
