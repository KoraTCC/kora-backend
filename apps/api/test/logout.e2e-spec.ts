import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { hashToken } from '../src/modules/auth/session.service.js';
import { createTestApp, uniqueIp } from './app.js';

const ORIGIN = 'http://localhost:5173';
const ACCESS_COOKIE = '__Host-kora_at';
const REFRESH_COOKIE = '__Secure-kora_rt';

function cookiesOf(res: request.Response): string[] {
  const header = res.headers['set-cookie'] as unknown;
  return Array.isArray(header) ? (header as string[]) : [];
}

function cookieValue(res: request.Response, name: string): string {
  const cookie = cookiesOf(res).find((item) => item.startsWith(`${name}=`));
  return cookie!.split(';')[0]!.slice(name.length + 1);
}

describe('POST /auth/logout (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  async function newSession() {
    return request(app.getHttpServer())
      .post('/auth/register')
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', uniqueIp())
      .send({
        name: 'Logout User',
        email: `logout-${uniqueIp().replaceAll('.', '-')}@example.com`,
        password: 'cavalo bateria grampo correto',
      })
      .expect(201);
  }

  it('revoga a família da sessão, registra auditoria e limpa os cookies', async () => {
    const session = await newSession();
    const refreshToken = cookieValue(session, REFRESH_COOKIE);

    const res = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', uniqueIp())
      .set('Cookie', `${REFRESH_COOKIE}=${refreshToken}`)
      .expect(204);

    const [token] = await db.query(
      `SELECT user_id, revoked_at FROM refresh_tokens WHERE token_hash = $1`,
      [hashToken(refreshToken)],
    );
    expect(token.revoked_at).not.toBeNull();

    const events = await db.query(
      `SELECT event FROM audit_logs WHERE user_id = $1 AND event = 'LOGOUT'`,
      [token.user_id],
    );
    expect(events).toHaveLength(1);

    const cleared = cookiesOf(res);
    expect(
      cleared.some((cookie) => cookie.startsWith(`${ACCESS_COOKIE}=;`)),
    ).toBe(true);
    expect(
      cleared.some((cookie) => cookie.startsWith(`${REFRESH_COOKIE}=;`)),
    ).toBe(true);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', uniqueIp())
      .set('Cookie', `${REFRESH_COOKIE}=${refreshToken}`)
      .expect(401);
  });

  it('permanece idempotente quando não há refresh token', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', uniqueIp())
      .expect(204);

    expect(cookiesOf(res)).toHaveLength(2);
  });
});
