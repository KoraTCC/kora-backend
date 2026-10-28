import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp } from './app.js';

describe('Schema do banco (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('as migrations deixam o banco idêntico às entidades', async () => {
    // Se alguém mudar uma entidade e esquecer a migration (ou escrever uma
    // migration diferente da entidade), o TypeORM vê diferença aqui.
    const sql = await app.get(DataSource).driver.createSchemaBuilder().log();
    expect(sql.upQueries.map((q) => q.query)).toEqual([]);
  });
});
