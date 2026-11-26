import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { hashToken } from '../src/modules/auth/session.service.js';
import { currentStep, totpAt } from '../src/modules/auth/totp.js';
import { createTestApp, uniqueIp } from './app.js';
import { ORIGIN } from './session.js';

const PASSWORD = 'cavalo bateria grampo correto';
const SESSION_COOKIE = '__Host-kora_at';
const CHALLENGE_COOKIE = '__Secure-kora_2fa';

describe('Verificação em duas etapas (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let counter = 0;

  const cookiesOf = (res: request.Response): string[] =>
    (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  const cookieHeader = (res: request.Response) =>
    cookiesOf(res)
      .map((c) => c.split(';')[0])
      .filter((c) => !c!.endsWith('='))
      .join('; ');

  const post = (path: string, body?: object, cookie?: string) => {
    const req = request(app.getHttpServer())
      .post(path)
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', uniqueIp());
    if (cookie) req.set('Cookie', cookie);
    return req.send(body);
  };
  const get = (path: string, cookie: string) =>
    request(app.getHttpServer()).get(path).set('Cookie', cookie);

  /** Código do app para o período atual (como o celular mostraria). */
  const code = (secret: string, offset = 0) =>
    totpAt(secret, currentStep() + offset);

  /**
   * O anti-replay não deixa usar o mesmo período duas vezes, e os testes
   * rodam dentro de poucos segundos: "volta o relógio" do último uso.
   */
  const forgetLastStep = (email: string) =>
    db.query(`UPDATE users SET two_factor_last_step = NULL WHERE email = $1`, [
      email,
    ]);

  /** Conta com 2FA ativo: devolve e-mail, segredo, sessão e códigos. */
  async function accountWithTwoFactor() {
    counter += 1;
    const email = `dois-fatores-${counter}-${Date.now()}@example.com`;
    const reg = await post('/auth/register', {
      name: 'Pessoa',
      email,
      password: PASSWORD,
    }).expect(201);
    const session = cookieHeader(reg);

    const setup = (
      await post('/auth/2fa/setup', undefined, session).expect(200)
    ).body;
    const enabled = await post(
      '/auth/2fa/enable',
      { code: code(setup.secret) },
      session,
    ).expect(200);
    await forgetLastStep(email);
    return {
      email,
      secret: setup.secret as string,
      session,
      recoveryCodes: enabled.body.recoveryCodes as string[],
    };
  }

  async function loginChallenge(email: string) {
    const res = await post('/auth/login', { email, password: PASSWORD }).expect(
      200,
    );
    return { res, challenge: cookieHeader(res) };
  }

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('ativa com QR code + código e devolve 10 códigos de recuperação', async () => {
    counter += 1;
    const email = `ativar-${counter}-${Date.now()}@example.com`;
    const session = cookieHeader(
      await post('/auth/register', {
        name: 'Pessoa',
        email,
        password: PASSWORD,
      }).expect(201),
    );
    expect((await get('/auth/2fa', session).expect(200)).body).toEqual({
      enabled: false,
      enabledAt: null,
      recoveryCodesLeft: 0,
    });

    const setup = (
      await post('/auth/2fa/setup', undefined, session).expect(200)
    ).body;
    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.otpauthUri).toContain(`secret=${setup.secret}`);
    expect(setup.otpauthUri).toContain('issuer=Kora');

    // Código errado não ativa.
    await post('/auth/2fa/enable', { code: '000000' }, session).expect(400);

    const { body } = await post(
      '/auth/2fa/enable',
      { code: code(setup.secret) },
      session,
    ).expect(200);
    expect(body.recoveryCodes).toHaveLength(10);
    for (const rc of body.recoveryCodes)
      expect(rc).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);

    const [user] = await db.query(
      `SELECT two_factor_secret, two_factor_pending_secret FROM users WHERE email = $1`,
      [email],
    );
    // Segredo cifrado (AES-GCM), nunca em claro.
    expect(user.two_factor_secret).toMatch(/^v1\./);
    expect(user.two_factor_secret).not.toContain(setup.secret);
    expect(user.two_factor_pending_secret).toBeNull();
    const hashes = await db.query(
      `SELECT code_hash FROM two_factor_recovery_codes rc JOIN users u ON u.id = rc.user_id WHERE u.email = $1`,
      [email],
    );
    expect(hashes.map((h: { code_hash: string }) => h.code_hash)).toContain(
      hashToken(body.recoveryCodes[0]),
    );

    expect((await get('/auth/me', session)).body.user.twoFactorEnabled).toBe(
      true,
    );
    expect((await get('/auth/2fa', session)).body).toMatchObject({
      enabled: true,
      recoveryCodesLeft: 10,
    });
    await post('/auth/2fa/setup', undefined, session).expect(409);
  });

  it('com 2FA, a senha certa não abre sessão: pede o código', async () => {
    const { email } = await accountWithTwoFactor();
    const { res } = await loginChallenge(email);

    expect(res.body).toEqual({ twoFactorRequired: true });
    const cookies = cookiesOf(res);
    expect(cookies.some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(false);
    const challenge = cookies.find((c) => c.startsWith(`${CHALLENGE_COOKIE}=`));
    expect(challenge).toMatch(/HttpOnly/);
    expect(challenge).toMatch(/SameSite=Strict/);
    expect(challenge).toMatch(/Path=\/auth\/2fa/);
  });

  it('código certo abre a sessão; o mesmo código não vale de novo', async () => {
    const { email, secret } = await accountWithTwoFactor();
    const { challenge } = await loginChallenge(email);
    // Calculado uma vez: se o período de 30 s virar no meio do teste, o
    // código reusado continua sendo o mesmo.
    const used = code(secret);

    const ok = await post('/auth/2fa/verify', { code: used }, challenge).expect(
      200,
      { ok: true },
    );
    const session = cookieHeader(ok);
    expect(session).toContain(SESSION_COOKIE);
    expect((await get('/auth/me', session).expect(200)).body.user.email).toBe(
      email,
    );

    // Anti-replay: mesmo código, novo login.
    const again = await loginChallenge(email);
    await post('/auth/2fa/verify', { code: used }, again.challenge).expect(400);
  });

  it('código errado: 400 no campo e conta para o bloqueio', async () => {
    const { email, secret } = await accountWithTwoFactor();
    const { challenge } = await loginChallenge(email);

    const res = await post(
      '/auth/2fa/verify',
      { code: '000000' },
      challenge,
    ).expect(400);
    expect(res.body.issues[0].path).toBe('code');

    for (let i = 0; i < 4; i++) {
      await post('/auth/2fa/verify', { code: '000000' }, challenge).expect(400);
    }
    // 5 falhas: conta travada, nem o código certo entra agora.
    await post('/auth/2fa/verify', { code: code(secret) }, challenge).expect(
      401,
    );
  });

  it('código de recuperação entra uma vez só', async () => {
    const { email, recoveryCodes } = await accountWithTwoFactor();
    const [recovery] = recoveryCodes;

    const first = await loginChallenge(email);
    // Aceita maiúsculas e sem hífen.
    const typed = recovery!.replace('-', '').toUpperCase();
    await post('/auth/2fa/verify', { code: typed }, first.challenge).expect(
      200,
    );

    const second = await loginChallenge(email);
    await post('/auth/2fa/verify', { code: recovery }, second.challenge).expect(
      400,
    );
  });

  it('sem desafio, ou com outro token no lugar, responde 401', async () => {
    const { secret, session } = await accountWithTwoFactor();
    await post('/auth/2fa/verify', { code: code(secret) }).expect(401);

    // Access token no lugar do desafio: audiência diferente, recusado.
    const accessToken = session
      .split('; ')
      .find((c) => c.startsWith(SESSION_COOKIE))!
      .split('=')[1];
    await post(
      '/auth/2fa/verify',
      { code: code(secret) },
      `${CHALLENGE_COOKIE}=${accessToken}`,
    ).expect(401);

    // Desafio vencido.
    const [user] = await db.query(
      `SELECT id FROM users WHERE two_factor_enabled_at IS NOT NULL LIMIT 1`,
    );
    const expired = await app.get(JwtService).signAsync(
      {
        sub: user.id,
        purpose: '2fa',
        exp: Math.floor(Date.now() / 1000) - 60,
      },
      { issuer: 'kora-api', audience: 'kora-2fa', algorithm: 'HS256' },
    );
    await post(
      '/auth/2fa/verify',
      { code: code(secret) },
      `${CHALLENGE_COOKIE}=${expired}`,
    ).expect(401);
  });

  it('desativar exige senha e código; depois o login volta a ser direto', async () => {
    const { email, secret, session } = await accountWithTwoFactor();

    const wrongPassword = await post(
      '/auth/2fa/disable',
      { password: 'senha errada qualquer', code: code(secret) },
      session,
    ).expect(400);
    expect(wrongPassword.body.issues[0].path).toBe('password');
    await post(
      '/auth/2fa/disable',
      { password: PASSWORD, code: '000000' },
      session,
    ).expect(400);

    await post(
      '/auth/2fa/disable',
      { password: PASSWORD, code: code(secret) },
      session,
    ).expect(200);
    expect((await get('/auth/2fa', session)).body.enabled).toBe(false);

    // Os avisos vão para a fila na mesma transação: a tentativa com código
    // errado foi desfeita e não deixou e-mail para trás.
    const emails: Array<{ subject: string }> = await db.query(
      `SELECT payload->>'subject' AS subject FROM jobs
        WHERE type = 'send_email' AND payload->>'to' = $1
        ORDER BY created_at, id`,
      [email],
    );
    expect(emails.map((e) => e.subject)).toEqual([
      'Verificação em duas etapas ativada na Kora',
      'Verificação em duas etapas desativada na Kora',
    ]);

    const res = await post('/auth/login', { email, password: PASSWORD }).expect(
      200,
    );
    expect(res.body.user.email).toBe(email);
  });

  it('regenerar invalida os códigos antigos', async () => {
    const { email, secret, session, recoveryCodes } =
      await accountWithTwoFactor();
    const fresh = (
      await post(
        '/auth/2fa/recovery-codes',
        { code: code(secret) },
        session,
      ).expect(200)
    ).body.recoveryCodes as string[];
    expect(fresh).toHaveLength(10);
    expect(fresh).not.toContain(recoveryCodes[0]);

    const { challenge } = await loginChallenge(email);
    await post(
      '/auth/2fa/verify',
      { code: recoveryCodes[0] },
      challenge,
    ).expect(400);
    await post('/auth/2fa/verify', { code: fresh[0] }, challenge).expect(200);
  });

  it('sem 2FA ativo, o login continua igual', async () => {
    counter += 1;
    const email = `sem-2fa-${counter}-${Date.now()}@example.com`;
    await post('/auth/register', {
      name: 'Pessoa',
      email,
      password: PASSWORD,
    }).expect(201);
    const res = await post('/auth/login', { email, password: PASSWORD }).expect(
      200,
    );
    expect(res.body.user).toMatchObject({ email, twoFactorEnabled: false });
    expect(cookiesOf(res).some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(
      true,
    );
  });
});
