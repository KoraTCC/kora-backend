import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp, uniqueIp } from './app.js';

const ORIGIN = 'http://localhost:5173';
const account = {
  name: 'Bruno Lima',
  email: 'bruno@example.com',
  password: 'cavalo bateria grampo correto',
};

function accessCookieOf(res: request.Response): string {
  const header = res.headers['set-cookie'] as unknown;
  const cookies = Array.isArray(header) ? (header as string[]) : [];
  return cookies.find((c) => c.startsWith('__Host-kora_at='))!.split(';')[0]!;
}

describe('GET /auth/me (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let accessCookie: string;
  let userId: string;

  const me = (cookie?: string) => {
    const req = request(app.getHttpServer()).get('/auth/me');
    return cookie ? req.set('Cookie', cookie) : req;
  };

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', uniqueIp())
      .send(account)
      .expect(201);
    accessCookie = accessCookieOf(res);
    userId = res.body.user.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('devolve o usuário da sessão', async () => {
    const res = await me(accessCookie).expect(200);
    expect(res.body.user).toEqual({
      id: userId,
      name: account.name,
      email: account.email,
      createdAt: expect.any(String),
    });
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash/i);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('recusa sem cookie, com token adulterado ou assinado com outro segredo', async () => {
    await me().expect(401);
    await me(`${accessCookie}x`).expect(401);

    const forged = await new JwtService().signAsync(
      { sub: userId, sid: 'x' },
      {
        secret: 'outro-segredo-0123456789abcdef0123456789',
        issuer: 'kora-api',
        audience: 'kora-web',
      },
    );
    await me(`__Host-kora_at=${forged}`).expect(401);
  });

  it('recusa token expirado', async () => {
    const jwt = app.get(JwtService);
    const expired = await jwt.signAsync(
      { sub: userId, sid: 'x' },
      { issuer: 'kora-api', audience: 'kora-web', expiresIn: -10 },
    );
    await me(`__Host-kora_at=${expired}`).expect(401);
  });

  it('recusa token emitido antes da última troca de senha', async () => {
    await db.query(
      `UPDATE users SET password_changed_at = now() + interval '1 minute' WHERE id = $1`,
      [userId],
    );
    const res = await me(accessCookie).expect(401);
    expect(res.body.message).toBe('Sessão expirada ou inválida.');
  });
});
