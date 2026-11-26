import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './app.js';
import { as, newSession } from './session.js';

const ETH_ADDRESS = '0x7a3f9b2c4e81d5a6b0c9e2f1a4d3c8b7e6f5d419';

describe('Dashboard (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  async function merchantWithWallet() {
    const api = as(app, await newSession(app));
    await api
      .post('/wallets', { address: ETH_ADDRESS, network: 'sepolia' })
      .expect(201);
    const [wallet] = (await api.get('/wallets')).body;
    const createCharge = async (amountCents: number, reference: string) =>
      (
        await api
          .post('/charges', {
            amountCents,
            network: 'sepolia',
            walletId: wallet.id,
            tolerance: '0.01',
            reference,
            customerEmail: 'cliente@example.com',
            description: 'Pedido',
            expiresInMinutes: '30',
            sendEmail: false,
          })
          .expect(201)
      ).body.id as string;
    return { api, createCharge };
  }

  it('exige sessão', async () => {
    await request(app.getHttpServer()).get('/dashboard').expect(401);
  });

  it('conta nova: tudo zerado, sem inventar números', async () => {
    const api = as(app, await newSession(app));
    const { body } = await api.get('/dashboard').expect(200);

    expect(body.balance).toEqual({ availableCents: 0, todayCents: 0 });
    expect(body.volume).toMatchObject({
      totalCents: 0,
      delta: 0,
      breakdown: 'Nenhum recebimento no período',
    });
    expect(body.volume.points).toHaveLength(7);
    expect(
      body.volume.points.every((p: { value: number }) => p.value === 0),
    ).toBe(true);
    expect(body.distribution).toEqual([]);
    expect(body.events).toEqual([]);
    expect(
      body.integration.map((s: { id: string; isDone: boolean }) => [
        s.id,
        s.isDone,
      ]),
    ).toEqual([
      ['api-key', false],
      ['wallet', false],
      ['webhook', false],
      ['test', false],
    ]);
  });

  it('calcula saldo, volume, distribuição e eventos das cobranças', async () => {
    const { api, createCharge } = await merchantWithWallet();
    const recent = await createCharge(24_900, 'PED-NOVO');
    const old = await createCharge(10_000, 'PED-ANTIGO');
    await createCharge(5_000, 'PED-ABERTO');
    for (const id of [recent, old]) {
      await api
        .post(`/charges/${id}/simulate`, { outcome: 'confirmed' })
        .expect(200);
    }
    // A antiga foi confirmada há 8 dias: fora dos 7 dias, dentro do período anterior.
    await db.query(
      `UPDATE charges SET confirmed_at = now() - interval '8 days',
              updated_at = now() - interval '8 days' WHERE id = $1`,
      [old],
    );

    const { body } = await api.get('/dashboard?range=7d').expect(200);

    expect(body.balance.availableCents).toBe(34_900);
    expect(body.balance.todayCents).toBe(24_900);
    expect(body.volume.totalCents).toBe(24_900);
    expect(body.volume.delta).toBeCloseTo((24_900 - 10_000) / 10_000);
    expect(body.volume.breakdown).toMatch(/^≈ .+ ETH$/);
    expect(
      body.volume.points.reduce(
        (sum: number, p: { value: number }) => sum + p.value,
        0,
      ),
    ).toBe(249);
    expect(body.volume.points.at(-1).value).toBe(249);
    expect(body.distribution).toEqual([{ network: 'sepolia', share: 1 }]);

    const done = Object.fromEntries(
      body.integration.map((s: { id: string; isDone: boolean }) => [
        s.id,
        s.isDone,
      ]),
    );
    expect(done).toMatchObject({ wallet: true, test: true, webhook: false });

    expect(
      body.events.map((e: { tone: string; title: string }) => [
        e.tone,
        e.title,
      ]),
    ).toEqual([
      ['confirmed', 'Cobrança PED-NOVO confirmada'],
      ['pending', 'Cobrança PED-ABERTO criada'],
      ['confirmed', 'Cobrança PED-ANTIGO confirmada'],
    ]);

    // Em 30 dias, as duas confirmadas entram.
    const month = (await api.get('/dashboard?range=30d').expect(200)).body;
    expect(month.volume.totalCents).toBe(34_900);
    expect(month.volume.points).toHaveLength(10);
    const day = (await api.get('/dashboard?range=24h').expect(200)).body;
    expect(day.volume.points).toHaveLength(8);
    expect(day.volume.points.at(-1).label).toMatch(/^\d{2}h$/);
  });

  it('período inválido é 400', async () => {
    const api = as(app, await newSession(app));
    await api.get('/dashboard?range=1y').expect(400);
  });
});
