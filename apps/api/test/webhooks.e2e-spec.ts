import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './app.js';
import { as, newSession } from './session.js';

const URL_A = 'https://lojaexemplo.com/kora/hooks';
const URL_B = 'https://staging.lojaexemplo.com/hooks';

describe('Webhooks (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('exige sessão', async () => {
    await request(app.getHttpServer()).get('/webhooks/endpoints').expect(401);
  });

  it('cadastra, lista, pausa, reativa e remove endpoints', async () => {
    const api = as(app, await newSession(app));
    expect((await api.get('/webhooks/endpoints').expect(200)).body).toEqual([]);

    await api
      .post('/webhooks/endpoints', { url: URL_A })
      .expect(201, { ok: true });
    const [endpoint] = (await api.get('/webhooks/endpoints')).body;
    expect(endpoint).toMatchObject({
      url: URL_A,
      status: 'active',
      consecutiveFailures: 0,
      lastDeliveryAt: null,
      nextRetryAt: null,
    });
    expect(endpoint.events).toHaveLength(6);

    await api
      .patch(`/webhooks/endpoints/${endpoint.id}`, { status: 'paused' })
      .expect(200);
    expect((await api.get('/webhooks/endpoints')).body[0].status).toBe(
      'paused',
    );
    await api
      .patch(`/webhooks/endpoints/${endpoint.id}`, { status: 'active' })
      .expect(200);

    await api
      .delete(`/webhooks/endpoints/${endpoint.id}`)
      .expect(200, { ok: true });
    expect((await api.get('/webhooks/endpoints')).body).toEqual([]);
  });

  it('recusa duplicado e respeita o limite do plano', async () => {
    const api = as(app, await newSession(app));
    await api.post('/webhooks/endpoints', { url: URL_A }).expect(201);
    await api.post('/webhooks/endpoints', { url: URL_A }).expect(409);
    await api.post('/webhooks/endpoints', { url: URL_B }).expect(201);
    await api
      .post('/webhooks/endpoints', { url: 'https://c.lojaexemplo.com/h' })
      .expect(201);
    await api
      .post('/webhooks/endpoints', { url: 'https://d.lojaexemplo.com/h' })
      .expect(409);

    const merchant = (await api.get('/merchants/me')).body;
    expect(merchant.plan.webhookEndpointsUsed).toBe(3);
  });

  it.each([
    'http://lojaexemplo.com/hooks',
    'https://localhost/hooks',
    'https://127.0.0.1/hooks',
    'https://169.254.169.254/latest/meta-data',
    'nao-e-url',
  ])('recusa URL insegura ou inválida: %s', async (url) => {
    const api = as(app, await newSession(app));
    const res = await api.post('/webhooks/endpoints', { url }).expect(400);
    expect(res.body.issues[0].path).toBe('url');
  });

  it('isola endpoints entre merchants (404)', async () => {
    const alice = as(app, await newSession(app));
    const bob = as(app, await newSession(app));
    await alice.post('/webhooks/endpoints', { url: URL_A }).expect(201);
    const [endpoint] = (await alice.get('/webhooks/endpoints')).body;

    expect((await bob.get('/webhooks/endpoints')).body).toEqual([]);
    await bob
      .patch(`/webhooks/endpoints/${endpoint.id}`, { status: 'paused' })
      .expect(404);
    await bob.delete(`/webhooks/endpoints/${endpoint.id}`).expect(404);
  });

  it('salva os eventos assinados', async () => {
    const api = as(app, await newSession(app));
    const before = (await api.get('/webhooks/subscription').expect(200)).body;
    expect(before.every((item: { isEnabled: boolean }) => item.isEnabled)).toBe(
      true,
    );

    await api
      .put('/webhooks/subscription', {
        events: ['charge.confirmed', 'charge.failed'],
      })
      .expect(200);
    const after = (await api.get('/webhooks/subscription')).body;
    expect(
      after
        .filter((item: { isEnabled: boolean }) => item.isEnabled)
        .map((i: { event: string }) => i.event),
    ).toEqual(['charge.confirmed', 'charge.failed']);

    await api
      .put('/webhooks/subscription', { events: ['charge.nao-existe'] })
      .expect(400);
  });

  it('gera o segredo uma vez e mantém o mesmo', async () => {
    const api = as(app, await newSession(app));
    const first = (await api.get('/webhooks/secret').expect(200)).body;
    expect(first).toEqual({
      secret: expect.stringMatching(/^whsec_[\w-]{32}$/),
      algorithm: 'HMAC-SHA256',
    });
    expect((await api.get('/webhooks/secret')).body.secret).toBe(first.secret);

    const other = as(app, await newSession(app));
    expect((await other.get('/webhooks/secret')).body.secret).not.toBe(
      first.secret,
    );
  });

  it('entregas e indicadores vazios (ainda não há envio)', async () => {
    const api = as(app, await newSession(app));
    expect(
      (await api.get('/webhooks/deliveries?limit=6').expect(200)).body,
    ).toEqual([]);
    expect(
      (await api.get('/webhooks/deliveries?page=1').expect(200)).body,
    ).toMatchObject({
      items: [],
      total: 0,
      counts: { all: 0, success: 0, failed: 0, retrying: 0 },
    });
    expect((await api.get('/webhooks/stats').expect(200)).body).toMatchObject({
      delivered: 0,
      successTarget: 0.99,
    });
    const failure = await api
      .get('/webhooks/deliveries/latest-failure')
      .expect(200);
    expect(
      failure.body === null || Object.keys(failure.body).length === 0,
    ).toBe(true);
  });
});
