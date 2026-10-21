import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp, uniqueIp } from './app.js';

const ORIGIN = 'http://localhost:5173';
const valid = {
  name: 'Maria Silva',
  email: '  Maria@Example.COM ',
  password: 'cavalo bateria grampo correto',
};

function cookiesOf(res: request.Response): string[] {
  const header = res.headers['set-cookie'] as unknown;
  return Array.isArray(header) ? (header as string[]) : [];
}

describe('POST /auth/register (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;

  const register = (body: object, ip = uniqueIp()) =>
    request(app.getHttpServer())
      .post('/auth/register')
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', ip)
      .send(body);

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('cria a conta, normaliza o e-mail e não devolve dados sensíveis', async () => {
    const res = await register(valid).expect(201);

    expect(res.body.user).toEqual({
      id: expect.any(String),
      name: 'Maria Silva',
      email: 'maria@example.com',
      createdAt: expect.any(String),
    });
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash/i);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('abre a sessão com cookies httpOnly, Secure e SameSite', async () => {
    const res = await register({ ...valid, email: 'joao@example.com' }).expect(
      201,
    );
    const [access, refresh] = [
      cookiesOf(res).find((c) => c.startsWith('__Host-kora_at=')),
      cookiesOf(res).find((c) => c.startsWith('__Secure-kora_rt=')),
    ];

    expect(access).toMatch(/HttpOnly/);
    expect(access).toMatch(/Secure/);
    expect(access).toMatch(/SameSite=Lax/);
    expect(access).toMatch(/Path=\/;/);
    expect(access).not.toMatch(/Domain=/);

    expect(refresh).toMatch(/HttpOnly/);
    expect(refresh).toMatch(/Secure/);
    expect(refresh).toMatch(/SameSite=Strict/);
    expect(refresh).toMatch(/Path=\/auth/);
  });

  it('guarda só hashes no banco: senha com scrypt e refresh token com SHA-256', async () => {
    const res = await register({ ...valid, email: 'ana@example.com' }).expect(
      201,
    );
    const refresh = cookiesOf(res)
      .find((c) => c.startsWith('__Secure-kora_rt='))!
      .split(';')[0]!
      .split('=')[1]!;

    const [user] = await db.query(
      `SELECT password_hash FROM users WHERE email = 'ana@example.com'`,
    );
    expect(user.password_hash).toMatch(/^scrypt\$ln=15,r=8,p=3\$/);
    expect(user.password_hash).not.toContain(valid.password);

    const tokens = await db.query(
      `SELECT token_hash FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
       WHERE u.email = 'ana@example.com'`,
    );
    expect(tokens).toHaveLength(1);
    expect(tokens[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokens[0].token_hash).not.toBe(refresh);
  });

  it('registra o cadastro na auditoria', async () => {
    const [row] = await db.query(
      `SELECT a.event FROM audit_logs a JOIN users u ON u.id = a.user_id
       WHERE u.email = 'maria@example.com'`,
    );
    expect(row.event).toBe('REGISTER');
  });

  it('recusa e-mail já cadastrado (mesmo com outra caixa) com 409', async () => {
    const res = await register({ ...valid, email: 'MARIA@example.com' }).expect(
      409,
    );
    expect(cookiesOf(res)).toHaveLength(0);
  });

  it.each([
    [{ ...valid, email: 'nao-e-email' }, 'email'],
    [{ ...valid, password: 'curta' }, 'password'],
    [{ ...valid, password: 'x'.repeat(129) }, 'password'],
    [{ ...valid, name: '' }, 'name'],
    [
      { ...valid, email: 'outro@example.com', password: 'password1234' },
      'password',
    ],
  ])('valida a entrada e devolve 400 (%#)', async (body, field) => {
    const res = await register(body).expect(400);
    expect(res.body.issues.map((i: { path: string }) => i.path)).toContain(
      field,
    );
  });

  it('ignora campos extras (ex.: tentar se promover)', async () => {
    const res = await register({
      ...valid,
      email: 'extra@example.com',
      failedLoginCount: -100,
      role: 'admin',
    }).expect(201);
    expect(res.body.user).not.toHaveProperty('role');
    const [user] = await db.query(
      `SELECT failed_login_count FROM users WHERE email = 'extra@example.com'`,
    );
    expect(user.failed_login_count).toBe(0);
  });

  it('bloqueia cadastro vindo de outra origem (CSRF)', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .set('Origin', 'https://evil.example')
      .send({ ...valid, email: 'csrf@example.com' })
      .expect(403);
  });

  it('limita tentativas por IP', async () => {
    const ip = '203.0.113.7';
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await register({ ...valid, email: `rl${i}@example.com` }, ip);
      statuses.push(res.status);
    }
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
    // Outro IP continua liberado.
    await register({ ...valid, email: 'rl-outro@example.com' }).expect(201);
  });
});
