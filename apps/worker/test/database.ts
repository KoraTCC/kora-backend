import 'reflect-metadata';
import { buildDataSourceOptions } from '@kora/database';
import { DataSource } from 'typeorm';

/** Banco de teste limpo, com o schema recriado pelas migrations. */
export async function createTestDataSource(): Promise<DataSource> {
  const dataSource = new DataSource(
    buildDataSourceOptions(process.env.DATABASE_URL!),
  );
  await dataSource.initialize();
  const { database } = dataSource.driver as unknown as { database: string };
  if (!database.endsWith('_test')) {
    throw new Error(
      `Recusando limpar o banco "${database}": use um banco *_test.`,
    );
  }
  await dataSource.dropDatabase();
  await dataSource.runMigrations();
  return dataSource;
}
