import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { hashToken } from '../src/modules/auth/session.service.js';
import { createTestApp, uniqueIp } from './app.js';

const ORIGIN = 'http://localhost:5173';
const PASSWORD = 'cavalo bateria grampo correto';

function cookiesOf(res: request.Response): string[] {
  const header = res.headers['set-cookie'] as unknown;
  return Array.isArray(header) ? (header as string[]) : [];
}

function cookieValue(res: request.Response, name: string): string {
  const cookie = cookiesOf(res).find((c) => c.startsWith(`${name}=`));
  return cookie!.split(';')[0]!.slice(name.length + 1);
}

const AT = '__Host-kora_at';
const RT = '__Secure-kora_rt';

describe('POST /auth/refresh (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let accounts = 0;

  const refresh = (refreshToken?: string, origin = ORIGIN) => {
    const req = request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Origin', origin)
      .set('X-Forwarded-For', uniqueIp());
    return refreshToken ? req.set('Cookie', `${RT}=${refreshToken}`) : req;
  };

  /** Cria uma conta nova e devolve o refresh token da sessão. */
  const newSession = async (): Promise<string> => {
    accounts += 1;
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', uniqueIp())
      .send({
        name: 'Rita Alves',
        email: `rita${accounts}@example.com`,
        password: PASSWORD,
      })
      .expect(201);
    return cookieValue(res, RT);
  };

  const tokenRow = async (token: string) => {
    const [row] = await db.query(
      `SELECT id, family_id, revoked_at, replaced_by_id FROM refresh_tokens
       WHERE token_hash = $1`,
      [hashToken(token)],
    );
    return row as {
      id: string;
      family_id: string;
      revoked_at: Date | null;
      replaced_by_id: string | null;
    };
  };

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rotaciona o refresh token e emite um access token que funciona', async () => {
    const original = await newSession();
    const res = await refresh(original).expect(200);

    expect(res.body.user.email).toBe(`rita${accounts}@example.com`);
    expect(res.headers['cache-control']).toBe('no-store');
    const rotated = cookieValue(res, RT);
    expect(rotated).not.toBe(original);

    const [old, next] = [await tokenRow(original), await tokenRow(rotated)];
    expect(old.revoked_at).not.toBeNull();
    expect(old.replaced_by_id).toBe(next.id);
    expect(next.family_id).toBe(old.family_id);
    expect(next.revoked_at).toBeNull();

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', `${AT}=${cookieValue(res, AT)}`)
      .expect(200);
  });

  it('recusa sem cookie e apaga os cookies da sessão', async () => {
    const res = await refresh().expect(401);
    expect(res.body.message).toBe('Sessão expirada ou inválida.');
    const cleared = cookiesOf(res);
    expect(cleared.some((c) => c.startsWith(`${AT}=;`))).toBe(true);
    expect(cleared.some((c) => c.startsWith(`${RT}=;`))).toBe(true);
  });

  it('recusa token desconhecido', async () => {
    await refresh('token-que-nao-existe').expect(401);
  });

  it('tolera reuso logo após a rotação (duas abas) sem derrubar a sessão', async () => {
    const original = await newSession();
    const rotated = cookieValue(await refresh(original).expect(200), RT);

    const loser = await refresh(original).expect(401);
    // Não apaga os cookies que a outra aba acabou de receber.
    expect(cookiesOf(loser)).toHaveLength(0);
    await refresh(rotated).expect(200);
  });

  it('derruba a família inteira quando um token antigo é reapresentado', async () => {
    const original = await newSession();
    const rotated = cookieValue(await refresh(original).expect(200), RT);
    const { family_id: familyId } = await tokenRow(original);
    // Simula o reuso fora da janela de tolerância.
    await db.query(
      `UPDATE refresh_tokens SET revoked_at = now() - interval '1 minute'
       WHERE token_hash = $1`,
      [hashToken(original)],
    );

    await refresh(original).expect(401);
    await refresh(rotated).expect(401);

    const active = await db.query(
      `SELECT 1 FROM refresh_tokens WHERE family_id = $1 AND revoked_at IS NULL`,
      [familyId],
    );
    expect(active).toHaveLength(0);
    const events = await db.query(
      `SELECT event FROM audit_logs WHERE event = 'REFRESH_REUSE'
       AND metadata->>'familyId' = $1`,
      [familyId],
    );
    expect(events).toHaveLength(1);
  });

  it('recusa quando a sessão passou do limite absoluto', async () => {
    const token = await newSession();
    await db.query(
      `UPDATE refresh_tokens SET session_expires_at = now() - interval '1 second'
       WHERE token_hash = $1`,
      [hashToken(token)],
    );
    await refresh(token).expect(401);
  });

  it('bloqueia renovação vinda de outra origem (CSRF)', async () => {
    const token = await newSession();
    await refresh(token, 'https://evil.example').expect(403);
    await refresh(token).expect(200);
  });
});
