import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp } from './app.js';
import { as, newSession } from './session.js';

const ETH_ADDRESS = '0x7a3f9b2c4e81d5a6b0c9e2f1a4d3c8b7e6f5d419';

type Api = ReturnType<typeof as>;

async function merchantWithWallet(app: INestApplication) {
  const api = as(app, await newSession(app));
  await api
    .post('/wallets', { address: ETH_ADDRESS, network: 'sepolia' })
    .expect(201);
  const [wallet] = (await api.get('/wallets')).body;
  return { api, walletId: wallet.id as string };
}

function chargeBody(walletId: string, overrides: object = {}) {
  return {
    amountCents: 24_900,
    network: 'sepolia',
    walletId,
    tolerance: '0.01',
    reference: 'PED-1001',
    customerEmail: 'cliente@example.com',
    description: 'Camiseta Kora',
    expiresInMinutes: '30',
    sendEmail: false,
    ...overrides,
  };
}

async function createCharge(
  api: Api,
  walletId: string,
  overrides: object = {},
) {
  const res = await api
    .post('/charges', chargeBody(walletId, overrides))
    .expect(201);
  return res.body.id as string;
}

describe('Cobranças (e2e)', () => {
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
    await request(app.getHttpServer()).get('/charges').expect(401);
  });

  it('cria com cotação travada e devolve o detalhe', async () => {
    const { api, walletId } = await merchantWithWallet(app);
    const id = await createCharge(api, walletId);

    const { body } = await api.get(`/charges/${id}`).expect(200);
    expect(body).toMatchObject({
      id,
      reference: 'PED-1001',
      origin: 'payment-link',
      amountCents: 24_900,
      cryptoAmount: '0.0185',
      asset: 'ETH',
      network: 'sepolia',
      status: 'pending',
      confirmations: 0,
      requiredConfirmations: 12,
      address: ETH_ADDRESS,
      lockedRateCents: 1_353_260,
      tolerance: 0.01,
      txHash: null,
      webhookAttempts: [],
    });
    expect(body.timeline.map((e: { id: string }) => e.id)).toEqual([
      'created',
      'awaiting',
    ]);
  });

  it('e-mail vazio vira null', async () => {
    const { api, walletId } = await merchantWithWallet(app);
    const id = await createCharge(api, walletId, { customerEmail: '' });
    expect((await api.get(`/charges/${id}`)).body.customerEmail).toBeNull();
  });

  it('recusa carteira de outra rede ou de outro merchant', async () => {
    const { api, walletId } = await merchantWithWallet(app);
    const wrongNetwork = await api
      .post('/charges', chargeBody(walletId, { network: 'amoy' }))
      .expect(400);
    expect(wrongNetwork.body.issues[0].path).toBe('walletId');

    const other = await merchantWithWallet(app);
    await api.post('/charges', chargeBody(other.walletId)).expect(400);
  });

  it('recusa rede desativada', async () => {
    const { api, walletId } = await merchantWithWallet(app);
    await api.patch('/networks', { enabledNetworks: ['amoy'] }).expect(200);
    const res = await api.post('/charges', chargeBody(walletId)).expect(400);
    expect(res.body.issues[0].path).toBe('network');
  });

  it('lista com filtros, paginação e contagens sem filtro', async () => {
    const { api, walletId } = await merchantWithWallet(app);
    const ids = [];
    for (let i = 0; i < 3; i++) {
      ids.push(await createCharge(api, walletId, { reference: `PED-${i}` }));
    }
    await api
      .post(`/charges/${ids[0]}/simulate`, { outcome: 'confirmed' })
      .expect(200);

    const page = (await api.get('/charges?page=1&pageSize=2').expect(200)).body;
    expect(page).toMatchObject({ page: 1, pageSize: 2, total: 3, totalAll: 3 });
    expect(page.items).toHaveLength(2);
    expect(page.counts).toMatchObject({ pending: 2, confirmed: 1, failed: 0 });

    const confirmed = (await api.get('/charges?status=confirmed').expect(200))
      .body;
    expect(confirmed.total).toBe(1);
    expect(confirmed.totalAll).toBe(3);
    expect(confirmed.items[0].id).toBe(ids[0]);

    const search = (await api.get('/charges?q=PED-2').expect(200)).body;
    expect(search.items.map((c: { reference: string }) => c.reference)).toEqual(
      ['PED-2'],
    );
  });

  it('simula confirmado, parcial e falha', async () => {
    const { api, walletId } = await merchantWithWallet(app);
    const [a, b, c] = [
      await createCharge(api, walletId),
      await createCharge(api, walletId),
      await createCharge(api, walletId),
    ];
    await api
      .post(`/charges/${a}/simulate`, { outcome: 'confirmed' })
      .expect(200);
    await api
      .post(`/charges/${b}/simulate`, { outcome: 'partial' })
      .expect(200);
    await api.post(`/charges/${c}/simulate`, { outcome: 'failed' }).expect(200);

    const confirmed = (await api.get(`/charges/${a}`)).body;
    expect(confirmed).toMatchObject({
      status: 'confirmed',
      confirmations: 12,
      receivedCryptoAmount: '0.0185',
    });
    expect(confirmed.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(confirmed.timeline.map((e: { id: string }) => e.id)).toEqual([
      'created',
      'detected',
      'confirmed',
    ]);

    expect((await api.get(`/charges/${b}`)).body).toMatchObject({
      status: 'partial',
      receivedCryptoAmount: '0.0092',
    });
    expect((await api.get(`/charges/${c}`)).body.status).toBe('failed');

    // Não dá para simular de novo uma cobrança encerrada.
    await api.post(`/charges/${a}/simulate`, { outcome: 'failed' }).expect(409);

    // A carteira passa a mostrar o valor liquidado.
    const [wallet] = (await api.get('/wallets')).body;
    expect(wallet).toMatchObject({
      settledCount: 1,
      settledLast7dCents: 24_900,
    });
  });

  it('calcula as estatísticas', async () => {
    const { api, walletId } = await merchantWithWallet(app);
    const a = await createCharge(api, walletId, { amountCents: 10_000 });
    await createCharge(api, walletId, { amountCents: 5_000 });
    const c = await createCharge(api, walletId, { amountCents: 20_000 });
    await api
      .post(`/charges/${a}/simulate`, { outcome: 'confirmed' })
      .expect(200);
    await api.post(`/charges/${c}/simulate`, { outcome: 'failed' }).expect(200);

    const { body } = await api.get('/charges/stats').expect(200);
    expect(body).toMatchObject({
      total: 3,
      pendingAmountCents: 5_000,
      receivedCents: 10_000,
      averageTicketCents: 10_000,
      conversionRate: 0.5,
    });
    expect(body.counts).toMatchObject({ pending: 1, confirmed: 1, failed: 1 });

    const merchant = (await api.get('/merchants/me')).body;
    expect(merchant.plan.chargesUsed).toBe(3);
  });

  it('expira cobranças vencidas na leitura', async () => {
    const { api, walletId } = await merchantWithWallet(app);
    const id = await createCharge(api, walletId);
    await db.query(
      `UPDATE charges SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [id],
    );

    const { body } = await api.get(`/charges/${id}`).expect(200);
    expect(body.status).toBe('expired');
    await api
      .post(`/charges/${id}/simulate`, { outcome: 'confirmed' })
      .expect(409);
  });

  it('isola cobranças entre merchants (404)', async () => {
    const alice = await merchantWithWallet(app);
    const bob = await merchantWithWallet(app);
    const id = await createCharge(alice.api, alice.walletId);

    await bob.api.get(`/charges/${id}`).expect(404);
    await bob.api
      .post(`/charges/${id}/simulate`, { outcome: 'confirmed' })
      .expect(404);
    expect((await bob.api.get('/charges')).body.total).toBe(0);
  });

  it('id inválido na URL responde 404', async () => {
    const { api } = await merchantWithWallet(app);
    await api.get('/charges/nao-e-uuid').expect(404);
  });

  it('não remove carteira que já recebeu cobrança', async () => {
    const { api, walletId } = await merchantWithWallet(app);
    await createCharge(api, walletId);
    await api.delete(`/wallets/${walletId}`).expect(400);
  });

  it('valida o corpo com issues nos nomes do formulário', async () => {
    const { api, walletId } = await merchantWithWallet(app);
    const res = await api
      .post(
        '/charges',
        chargeBody(walletId, {
          amountCents: 50,
          tolerance: '0.5',
          reference: '',
        }),
      )
      .expect(400);
    const paths = res.body.issues.map((i: { path: string }) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining(['amountCents', 'tolerance', 'reference']),
    );
  });
});
