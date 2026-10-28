import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { hashToken } from '../src/modules/auth/session.service.js';
import { createTestApp } from './app.js';
import { as, newSession } from './session.js';

const CREATE = { kind: 'secret', environment: 'test' };

describe('Chaves de API (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('exige sessão', async () => {
    await request(app.getHttpServer()).get('/api-keys').expect(401);
  });

  it('cria a chave publicável sozinha', async () => {
    const api = as(app, await newSession(app));
    const { body } = await api.get('/api-keys').expect(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ kind: 'publishable', callsLast7d: 0 });
    expect(body[0].maskedKey).toMatch(/^pk_test_.{4}….{4}$/);

    const creds = (await api.get('/api-keys/test').expect(200)).body;
    expect(creds.publishableKey).toMatch(/^pk_test_[\w-]{24}$/);
    expect(creds.secretKey).toBe('');
  });

  it('mostra a chave secreta uma vez e guarda só o hash', async () => {
    const api = as(app, await newSession(app));
    const { body } = await api.post('/api-keys', CREATE).expect(201);
    expect(body.secretKey).toMatch(/^sk_test_[\w-]{43}$/);

    const [row] = await db.query(
      `SELECT key_hash, public_key FROM api_keys WHERE key_hash = $1`,
      [hashToken(body.secretKey)],
    );
    expect(row.public_key).toBeNull();
    expect(JSON.stringify(row)).not.toContain(body.secretKey);

    // Depois, só a versão mascarada.
    const creds = (await api.get('/api-keys/test')).body;
    expect(creds.secretKey).toBe(
      `${body.secretKey.slice(0, 12)}…${body.secretKey.slice(-4)}`,
    );
    const list = (await api.get('/api-keys')).body;
    expect(JSON.stringify(list)).not.toContain(body.secretKey);
  });

  it('rotaciona: revoga a anterior e devolve uma nova', async () => {
    const api = as(app, await newSession(app));
    const first = (await api.post('/api-keys', CREATE).expect(201)).body
      .secretKey;
    const rotated = (await api.post('/api-keys/test/rotate').expect(200)).body
      .secretKey;
    expect(rotated).not.toBe(first);

    const secrets = (await api.get('/api-keys')).body.filter(
      (k: { kind: string }) => k.kind === 'secret',
    );
    expect(secrets).toHaveLength(1);
    expect(secrets[0].maskedKey.endsWith(rotated.slice(-4))).toBe(true);
  });

  it('revoga, respeita o limite e isola entre lojas', async () => {
    const api = as(app, await newSession(app));
    for (let i = 0; i < 5; i++) await api.post('/api-keys', CREATE).expect(201);
    await api.post('/api-keys', CREATE).expect(409);

    const secret = (await api.get('/api-keys')).body.find(
      (k: { kind: string }) => k.kind === 'secret',
    );
    const other = as(app, await newSession(app));
    await other.delete(`/api-keys/${secret.id}`).expect(404);

    await api.delete(`/api-keys/${secret.id}`).expect(200, { ok: true });
    await api.delete(`/api-keys/${secret.id}`).expect(404);
    await api.post('/api-keys', CREATE).expect(201);
  });

  it('só aceita chave secreta de teste', async () => {
    const api = as(app, await newSession(app));
    await api
      .post('/api-keys', { kind: 'secret', environment: 'live' })
      .expect(400);
  });
});
