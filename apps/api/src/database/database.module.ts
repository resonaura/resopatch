import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dataSourceOptions, entities } from './data-source';

@Module({
  imports: [TypeOrmModule.forRoot(dataSourceOptions), TypeOrmModule.forFeature(entities)],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
