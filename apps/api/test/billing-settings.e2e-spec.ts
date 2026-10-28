import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './app.js';
import { as, newSession } from './session.js';

const SETTINGS = {
  defaultTolerance: '0.02',
  defaultWindowMinutes: '60',
  referenceCurrency: 'USD',
  defaultNetwork: 'amoy',
  acceptOverpayment: false,
  autoExpire: true,
  sendReceipt: true,
  notifyDetected: false,
  remindBeforeExpiry: true,
  senderEmail: 'financeiro@lojaexemplo.com',
  returnUrl: 'https://lojaexemplo.com/obrigado',
};

describe('Configurações de cobrança (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('exige sessão', async () => {
    await request(app.getHttpServer()).get('/settings/billing').expect(401);
  });

  it('devolve padrões e salva as preferências', async () => {
    const api = as(app, await newSession(app));
    expect((await api.get('/settings/billing').expect(200)).body).toMatchObject(
      {
        defaultTolerance: '0.01',
        defaultWindowMinutes: '30',
        referenceCurrency: 'BRL',
        defaultNetwork: 'sepolia',
      },
    );

    await api.patch('/settings/billing', SETTINGS).expect(200, { ok: true });
    expect((await api.get('/settings/billing')).body).toEqual(SETTINGS);
  });

  it('valida com issues nos campos do formulário', async () => {
    const api = as(app, await newSession(app));
    const res = await api
      .patch('/settings/billing', {
        ...SETTINGS,
        defaultTolerance: '0.5',
        returnUrl: 'x',
      })
      .expect(400);
    const paths = res.body.issues.map((i: { path: string }) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining(['defaultTolerance', 'returnUrl']),
    );
  });

  it('calcula os indicadores a partir das cobranças', async () => {
    const api = as(app, await newSession(app));
    const empty = (await api.get('/settings/billing/insights').expect(200))
      .body;
    expect(empty).toMatchObject({ total: 0, withinTolerance: 0, expired: 0 });
    expect(empty.expirationByWindow).toHaveLength(4);

    await api
      .post('/wallets', {
        address: '0x7a3f9b2c4e81d5a6b0c9e2f1a4d3c8b7e6f5d419',
        network: 'sepolia',
      })
      .expect(201);
    const [wallet] = (await api.get('/wallets')).body;
    const charge = (expiresInMinutes: string) =>
      api
        .post('/charges', {
          amountCents: 10_000,
          network: 'sepolia',
          walletId: wallet.id,
          tolerance: '0.01',
          reference: 'PED',
          customerEmail: '',
          description: '',
          expiresInMinutes,
          sendEmail: false,
        })
        .expect(201);
    const { body: a } = await charge('15');
    await charge('15');
    await api
      .post(`/charges/${a.id}/simulate`, { outcome: 'confirmed' })
      .expect(200);

    const { body } = await api.get('/settings/billing/insights').expect(200);
    expect(body).toMatchObject({
      total: 2,
      withinTolerance: 1,
      partial: 0,
      expired: 0,
    });
    expect(body.suggestion).toBeTruthy();
  });
});
