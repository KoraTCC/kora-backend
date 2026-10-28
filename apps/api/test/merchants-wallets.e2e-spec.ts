import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './app.js';
import { as, newSession } from './session.js';

const ETH_ADDRESS = '0x7a3f9b2c4e81d5a6b0c9e2f1a4d3c8b7e6f5d419';
const profile = {
  name: 'Loja Exemplo',
  legalName: 'Loja Exemplo Comércio Digital LTDA',
  document: '41.208.774/0001-06',
  phone: '(11) 94002-8922',
  email: 'contato@lojaexemplo.com',
  website: 'https://lojaexemplo.com',
  displayName: 'Loja Exemplo',
  showLogo: true,
  showBackButton: false,
  postalCode: '01310-100',
  street: 'Av. Paulista, 1000',
  complement: 'Sala 42',
  city: 'São Paulo',
  state: 'sp',
  country: 'BR',
};

describe('Merchant, carteiras e redes (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('exige sessão', async () => {
    await request(app.getHttpServer()).get('/merchants/me').expect(401);
    await request(app.getHttpServer()).get('/wallets').expect(401);
  });

  it('cria o merchant no primeiro acesso, em modo teste', async () => {
    const api = as(app, await newSession(app));
    const res = await api.get('/merchants/me').expect(200);
    expect(res.body).toMatchObject({
      environment: 'test',
      status: 'active',
      checkout: { showLogo: true, showBackButton: true },
      plan: { chargesUsed: 0 },
    });
    // Mesma chamada não cria outro merchant.
    const again = await api.get('/merchants/me').expect(200);
    expect(again.body.id).toBe(res.body.id);
  });

  it('atualiza o perfil com o corpo plano do formulário', async () => {
    const api = as(app, await newSession(app));
    await api.patch('/merchants/me', profile).expect(200, { ok: true });

    const { body } = await api.get('/merchants/me').expect(200);
    expect(body).toMatchObject({
      name: 'Loja Exemplo',
      document: '41.208.774/0001-06',
      checkout: { displayName: 'Loja Exemplo', showBackButton: false },
      address: { postalCode: '01310-100', city: 'São Paulo', state: 'SP' },
    });
  });

  it('valida o perfil com issues nos nomes dos campos', async () => {
    const api = as(app, await newSession(app));
    const res = await api
      .patch('/merchants/me', { ...profile, document: '123', state: 'SPX' })
      .expect(400);
    const paths = res.body.issues.map((i: { path: string }) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['document', 'state']));
  });

  it('cadastra carteiras: a primeira da rede vira padrão', async () => {
    const api = as(app, await newSession(app));
    await api
      .post('/wallets', { address: ETH_ADDRESS, network: 'sepolia' })
      .expect(201);
    await api
      .post('/wallets', {
        address: ETH_ADDRESS.replace('7a', '8b'),
        network: 'sepolia',
      })
      .expect(201);

    const { body } = await api.get('/wallets').expect(200);
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({
      status: 'default',
      settledCount: 0,
      settledLast7dCents: 0,
    });
    expect(body[1].status).toBe('active');

    // Duplicada → 409.
    await api
      .post('/wallets', { address: ETH_ADDRESS, network: 'sepolia' })
      .expect(409);
  });

  it('ao remover a padrão, outra carteira da rede assume', async () => {
    const api = as(app, await newSession(app));
    await api
      .post('/wallets', { address: ETH_ADDRESS, network: 'sepolia' })
      .expect(201);
    await api
      .post('/wallets', {
        address: ETH_ADDRESS.replace('7a', '9c'),
        network: 'sepolia',
      })
      .expect(201);
    const [first] = (await api.get('/wallets')).body;

    await api.delete(`/wallets/${first.id}`).expect(200, { ok: true });
    const { body } = await api.get('/wallets').expect(200);
    expect(body).toHaveLength(1);
    expect(body[0].status).toBe('default');
  });

  it('isola carteiras entre merchants (404, não 403)', async () => {
    const alice = as(app, await newSession(app));
    const bob = as(app, await newSession(app));
    await alice
      .post('/wallets', { address: ETH_ADDRESS, network: 'sepolia' })
      .expect(201);
    const [wallet] = (await alice.get('/wallets')).body;

    expect((await bob.get('/wallets')).body).toEqual([]);
    await bob.delete(`/wallets/${wallet.id}`).expect(404);
  });

  it('liga e desliga redes, exigindo ao menos uma', async () => {
    const api = as(app, await newSession(app));
    expect((await api.get('/networks')).body).toEqual([
      { network: 'sepolia', isEnabled: true },
      { network: 'amoy', isEnabled: true },
      { network: 'bitcoin-testnet', isEnabled: true },
    ]);

    await api.patch('/networks', { enabledNetworks: ['amoy'] }).expect(200);
    const { body } = await api.get('/networks');
    expect(body.filter((n: { isEnabled: boolean }) => n.isEnabled)).toEqual([
      { network: 'amoy', isEnabled: true },
    ]);

    await api.patch('/networks', { enabledNetworks: [] }).expect(400);
  });
});
