import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { ENV, type Env } from '../src/config/env.js';
import { setupApp } from '../src/setup-app.js';

/** Sobe a aplicação completa contra o banco de teste, com o schema recriado pelas migrations. */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication({ logger: false });
  setupApp(app, app.get<Env>(ENV));
  await app.init();

  const dataSource = app.get(DataSource);
  const { database } = dataSource.driver as unknown as { database: string };
  if (!database.endsWith('_test')) {
    throw new Error(
      `Recusando limpar o banco "${database}": use um banco *_test.`,
    );
  }
  await dataSource.dropDatabase();
  await dataSource.runMigrations();
  return app;
}

let ipCounter = 0;

/** IP único por chamada, para os testes não dividirem o mesmo balde de rate limit. */
export function uniqueIp(): string {
  ipCounter += 1;
  return `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}
