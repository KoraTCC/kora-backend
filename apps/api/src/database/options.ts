import type { DataSourceOptions } from 'typeorm';
import { entities } from './entities.js';
import { migrations } from './migrations/index.js';

export function buildDataSourceOptions(databaseUrl: string): DataSourceOptions {
  return {
    type: 'postgres',
    url: databaseUrl,
    entities,
    migrations,
    // O schema só muda por migrations versionadas.
    synchronize: false,
    migrationsRun: false,
    // gen_random_uuid() é nativo no PostgreSQL 13+, sem extensão extra.
    uuidExtension: 'pgcrypto',
  };
}
