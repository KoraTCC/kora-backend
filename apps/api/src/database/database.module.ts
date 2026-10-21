import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ENV, type Env } from '../config/env.js';
import { buildDataSourceOptions } from './options.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => buildDataSourceOptions(env.DATABASE_URL),
    }),
  ],
})
export class DatabaseModule {}
