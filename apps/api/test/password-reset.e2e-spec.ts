import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import type { MockInstance } from 'vitest';
import { hashToken } from '../src/modules/auth/session.service.js';
import {
  MailService,
  type MailMessage,
} from '../src/modules/mail/mail.service.js';
import { createTestApp, uniqueIp } from './app.js';
import { ORIGIN } from './session.js';

const PASSWORD = 'cavalo bateria grampo correto';
const NEW_PASSWORD = 'outra frase longa e segura';

describe('Esqueceu a senha (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let sendMail: MockInstance<(message: MailMessage) => Promise<void>>;
  let counter = 0;

  const post = (path: string, body?: object, cookie?: string) => {
    const req = request(app.getHttpServer())
      .post(path)
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', uniqueIp());
    if (cookie) req.set('Cookie', cookie);
    return req.send(body);
  };

  /** Cria uma conta e devolve o e-mail e os cookies da sessão. */
  async function account() {
    counter += 1;
    const email = `reset-${counter}-${Date.now()}@example.com`;
    const res = await post('/auth/register', {
      name: 'Pessoa Teste',
      email,
      password: PASSWORD,
    }).expect(201);
    const cookie = (res.headers['set-cookie'] as unknown as string[])
      .map((c) => c.split(';')[0])
      .join('; ');
    return { email, cookie };
  }

  /** Pede o reset e devolve o token do link enviado por e-mail. */
  async function requestReset(email: string): Promise<string> {
    sendMail.mockClear();
    await post('/auth/password/forgot', { email }).expect(202, { ok: true });
    const message = sendMail.mock.calls.at(-1)?.[0];
    expect(message?.to).toBe(email);
    const link = /https?:\/\/\S+\/reset-password\?token=([\w-]+)/.exec(
      message!.text,
    );
    return link![1]!;
  }

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
    sendMail = vi.spyOn(app.get(MailService), 'send').mockResolvedValue();
  });

  afterAll(async () => {
    await app.close();
  });

  it('e-mail desconhecido recebe a mesma resposta e nada é enviado', async () => {
    sendMail.mockClear();
    await post('/auth/password/forgot', {
      email: 'ninguem@example.com',
    }).expect(202, {
      ok: true,
    });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('envia o link e guarda só o hash do token', async () => {
    const { email } = await account();
    const token = await requestReset(email);

    expect(token.length).toBeGreaterThanOrEqual(43);
    const rows = await db.query(
      `SELECT t.token_hash FROM password_reset_tokens t JOIN users u ON u.id = t.user_id
       WHERE u.email = $1`,
      [email],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(hashToken(token));
    expect(rows[0].token_hash).not.toBe(token);
  });

  it('redefine a senha, derruba as sessões e o link só vale uma vez', async () => {
    const { email, cookie } = await account();
    const token = await requestReset(email);
    // `iat` do JWT tem precisão de segundos: garante que a troca seja depois.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    sendMail.mockClear();

    await post('/auth/password/reset', {
      token,
      password: NEW_PASSWORD,
    }).expect(200, {
      ok: true,
    });

    // Aviso de senha alterada.
    expect(sendMail.mock.calls[0]?.[0].subject).toMatch(/senha.*alterada/i);
    // Senha antiga não entra mais; a nova entra.
    await post('/auth/login', { email, password: PASSWORD }).expect(401);
    await post('/auth/login', { email, password: NEW_PASSWORD }).expect(200);
    // A sessão antiga caiu: nem o access token nem o refresh valem.
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', cookie)
      .expect(401);
    await post('/auth/refresh', undefined, cookie).expect(401);
    // Reusar o link falha.
    await post('/auth/password/reset', {
      token,
      password: NEW_PASSWORD,
    }).expect(400);

    const events = await db.query(
      `SELECT a.event FROM audit_logs a JOIN users u ON u.id = a.user_id
       WHERE u.email = $1 AND a.event LIKE 'PASSWORD_RESET%' ORDER BY a.created_at`,
      [email],
    );
    expect(events.map((e: { event: string }) => e.event)).toEqual([
      'PASSWORD_RESET_REQUESTED',
      'PASSWORD_RESET_COMPLETED',
    ]);
  });

  it('um pedido novo invalida o link anterior', async () => {
    const { email } = await account();
    const first = await requestReset(email);
    const second = await requestReset(email);

    await post('/auth/password/reset', {
      token: first,
      password: NEW_PASSWORD,
    }).expect(400);
    await post('/auth/password/reset', {
      token: second,
      password: NEW_PASSWORD,
    }).expect(200);
  });

  it('link expirado não funciona', async () => {
    const { email } = await account();
    const token = await requestReset(email);
    await db.query(
      `UPDATE password_reset_tokens SET expires_at = now() - interval '1 minute' WHERE token_hash = $1`,
      [hashToken(token)],
    );
    await post('/auth/password/reset', {
      token,
      password: NEW_PASSWORD,
    }).expect(400);
  });

  it('token inventado não funciona', async () => {
    await post('/auth/password/reset', {
      token: 'inventado',
      password: NEW_PASSWORD,
    }).expect(400);
  });

  it('aplica a política de senha na nova senha', async () => {
    const { email } = await account();
    const token = await requestReset(email);
    const res = await post('/auth/password/reset', {
      token,
      password: 'password1234',
    }).expect(400);
    expect(res.body.issues[0].path).toBe('password');
    // O link continua válido para uma tentativa com senha boa.
    await post('/auth/password/reset', {
      token,
      password: NEW_PASSWORD,
    }).expect(200);
  });
});
