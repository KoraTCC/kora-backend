import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, uniqueIp } from './app.js';
import { ORIGIN } from './session.js';

const PASSWORD = 'cavalo bateria grampo correto';
const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

describe('Sessões e log de acesso (e2e)', () => {
  let app: INestApplication;
  let counter = 0;

  const cookieOf = (res: request.Response) =>
    (res.headers['set-cookie'] as unknown as string[])
      .map((c) => c.split(';')[0])
      .join('; ');

  const call = (
    method: 'get' | 'delete' | 'post',
    path: string,
    cookie?: string,
  ) => {
    const req = request(app.getHttpServer())
      [method](path)
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', uniqueIp());
    return cookie ? req.set('Cookie', cookie) : req;
  };

  /** Mesma conta logada em dois "dispositivos" (user-agents diferentes). */
  async function twoDevices() {
    counter += 1;
    const email = `sessoes-${counter}-${Date.now()}@example.com`;
    const desktop = await request(app.getHttpServer())
      .post('/auth/register')
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', uniqueIp())
      .set('User-Agent', CHROME_WINDOWS)
      .send({ name: 'Pessoa', email, password: PASSWORD })
      .expect(201);
    const phone = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', uniqueIp())
      .set('User-Agent', SAFARI_IPHONE)
      .send({ email, password: PASSWORD })
      .expect(200);
    return { email, desktop: cookieOf(desktop), phone: cookieOf(phone) };
  }

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lista os dispositivos e marca a sessão atual', async () => {
    const { desktop } = await twoDevices();
    const { body } = await call('get', '/sessions', desktop).expect(200);

    expect(body).toHaveLength(2);
    const current = body.find((s: { isCurrent: boolean }) => s.isCurrent);
    expect(current.device).toBe('Chrome · Windows');
    expect(body.find((s: { isCurrent: boolean }) => !s.isCurrent).device).toBe(
      'Safari · iOS',
    );
  });

  it('encerrar uma sessão derruba o outro dispositivo na hora', async () => {
    const { desktop, phone } = await twoDevices();
    await call('get', '/auth/me', phone).expect(200);

    const sessions = (await call('get', '/sessions', desktop)).body;
    const phoneSession = sessions.find(
      (s: { isCurrent: boolean }) => !s.isCurrent,
    );
    await call('delete', `/sessions/${phoneSession.id}`, desktop).expect(200, {
      ok: true,
    });

    // Sem esperar o access token vencer: o guard vê que a sessão acabou.
    await call('get', '/auth/me', phone).expect(401);
    await call('get', '/auth/me', desktop).expect(200);
  });

  it('encerra todas as outras sessões, menos a atual', async () => {
    const { desktop, phone } = await twoDevices();
    await call('delete', '/sessions/others', desktop).expect(200);

    await call('get', '/auth/me', phone).expect(401);
    const { body } = await call('get', '/sessions', desktop).expect(200);
    expect(body).toHaveLength(1);
    expect(body[0].isCurrent).toBe(true);
  });

  it('logout também derruba o access token na hora', async () => {
    const { desktop } = await twoDevices();
    await call('post', '/auth/logout', desktop).expect(204);
    await call('get', '/auth/me', desktop).expect(401);
  });

  it('não encerra sessão de outra pessoa (404)', async () => {
    const alice = await twoDevices();
    const bob = await twoDevices();
    const [aliceSession] = (await call('get', '/sessions', alice.desktop)).body;
    await call('delete', `/sessions/${aliceSession.id}`, bob.desktop).expect(
      404,
    );
  });

  it('mostra as tentativas de login no log de acesso', async () => {
    const { email, desktop } = await twoDevices();
    await call('post', '/auth/login')
      .send({ email, password: 'senha errada de proposito' })
      .expect(401);

    const { body } = await call('get', '/security/access-log', desktop).expect(
      200,
    );
    expect(body[0]).toMatchObject({
      isSuccess: false,
      location: expect.stringMatching(/^IP /),
    });
    expect(body.some((e: { isSuccess: boolean }) => e.isSuccess)).toBe(true);
  });
});
