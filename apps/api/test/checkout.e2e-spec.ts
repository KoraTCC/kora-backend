import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApp } from './app.js';
import { as, newSession } from './session.js';

const ETH_ADDRESS = '0x7a3f9b2c4e81d5a6b0c9e2f1a4d3c8b7e6f5d419';

describe('Checkout público (e2e)', () => {
  let app: INestApplication;

  // Sem cookie: é a visão do cliente que recebeu o link.
  const publicGet = (id: string) =>
    request(app.getHttpServer()).get(`/public/checkout/${id}`);

  async function chargeOfNewMerchant() {
    const api = as(app, await newSession(app));
    await api
      .patch('/merchants/me', {
        name: 'Loja Exemplo',
        legalName: 'Loja Exemplo LTDA',
        document: '41.208.774/0001-06',
        phone: '(11) 94002-8922',
        email: 'contato@lojaexemplo.com',
        website: 'https://lojaexemplo.com',
        displayName: 'Loja Exemplo',
        showLogo: true,
        showBackButton: true,
        postalCode: '01310-100',
        street: 'Av. Paulista, 1000',
        complement: '',
        city: 'São Paulo',
        state: 'SP',
        country: 'BR',
      })
      .expect(200);
    await api
      .post('/wallets', { address: ETH_ADDRESS, network: 'sepolia' })
      .expect(201);
    const [wallet] = (await api.get('/wallets')).body;
    const { body } = await api
      .post('/charges', {
        amountCents: 24_900,
        network: 'sepolia',
        walletId: wallet.id,
        tolerance: '0.01',
        reference: 'PED-1001',
        customerEmail: 'cliente@example.com',
        description: 'Pedido secreto',
        expiresInMinutes: '30',
        sendEmail: false,
      })
      .expect(201);
    return { api, id: body.id as string };
  }

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('mostra a cobrança sem login e sem dados do cliente', async () => {
    const { id } = await chargeOfNewMerchant();
    const { body } = await publicGet(id).expect(200);

    expect(body).toMatchObject({
      chargeId: id,
      reference: 'PED-1001',
      status: 'pending',
      amountCents: 24_900,
      cryptoAmount: '0.0185',
      asset: 'ETH',
      network: 'sepolia',
      address: ETH_ADDRESS,
      rateCents: 1_353_260,
      tolerance: 0.01,
      detectedAt: null,
      txHash: null,
      failureReason: null,
      merchant: { name: 'Loja Exemplo', returnUrl: 'https://lojaexemplo.com' },
    });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('cliente@example.com');
    expect(raw).not.toContain('Pedido secreto');
  });

  it('acompanha a simulação de pagamento feita no painel', async () => {
    const { api, id } = await chargeOfNewMerchant();
    await api
      .post(`/charges/${id}/simulate`, { outcome: 'confirmed' })
      .expect(200);

    const { body } = await publicGet(id).expect(200);
    expect(body.status).toBe('confirmed');
    expect(body.confirmations).toBe(12);
    expect(body.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.detectedAt).not.toBeNull();
  });

  it('pagamento parcial aparece como detectado para o pagador', async () => {
    const { api, id } = await chargeOfNewMerchant();
    await api
      .post(`/charges/${id}/simulate`, { outcome: 'partial' })
      .expect(200);
    expect((await publicGet(id).expect(200)).body.status).toBe('detected');
  });

  it('falha traz o motivo', async () => {
    const { api, id } = await chargeOfNewMerchant();
    await api
      .post(`/charges/${id}/simulate`, { outcome: 'failed' })
      .expect(200);
    const { body } = await publicGet(id).expect(200);
    expect(body.status).toBe('failed');
    expect(body.failureReason).toBeTruthy();
  });

  it('id inexistente ou inválido responde 404', async () => {
    await publicGet(randomUUID()).expect(404);
    await publicGet('nao-e-uuid').expect(404);
  });
});
