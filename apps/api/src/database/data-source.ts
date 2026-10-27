// Usado apenas pela CLI do TypeORM: `typeorm -d dist/database/data-source.js ...`
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { loadEnv } from '../config/env.js';
import { buildDataSourceOptions } from './options.js';

export default new DataSource(buildDataSourceOptions(loadEnv().DATABASE_URL));
