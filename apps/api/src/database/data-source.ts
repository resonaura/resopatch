import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { Setup } from './entities/setup.entity';
import { Device } from './entities/device.entity';
import { Port } from './entities/port.entity';
import { Adapter } from './entities/adapter.entity';
import { Cable } from './entities/cable.entity';
import { Furniture } from './entities/furniture.entity';

export const sqlitePath = process.env.SQLITE_PATH
  ? path.resolve(process.cwd(), process.env.SQLITE_PATH)
  : path.resolve(process.cwd(), 'data', 'resopatch.sqlite3');

fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });

export const entities = [Setup, Device, Port, Adapter, Cable, Furniture];

export const dataSourceOptions: DataSourceOptions = {
  type: 'better-sqlite3',
  database: sqlitePath,
  entities,
  // Single-band, single-environment tool — no migration ceremony needed, the schema just
  // tracks the entities. Re-seed (`pnpm seed`) if you need to reset the data.
  synchronize: true,
  logging: process.env.TYPEORM_LOGGING === 'true',
};

export const AppDataSource = new DataSource(dataSourceOptions);
