import type { INestApplication } from '@nestjs/common';
import { createHmac, randomBytes, scryptSync } from 'node:crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createTestApp, uniqueIp } from './app.js';

/** Hash no formato antigo (scrypt + pepper HMAC), como o das primeiras contas. */
function legacyScryptHash(password: string): string {
  const salt = randomBytes(16);
  const peppered = createHmac('sha256', process.env.PASSWORD_PEPPER!)
    .update(password.normalize('NFKC'))
    .digest();
  const key = scryptSync(peppered, salt, 64, {
    N: 2 ** 15,
    r: 8,
    p: 3,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$ln=15,r=8,p=3$${salt.toString('base64')}$${key.toString('base64')}`;
}

const ORIGIN = 'http://localhost:5173';
const account = {
  name: 'Carla Souza',
  email: 'carla@example.com',
  password: 'cavalo bateria grampo correto',
};
const INVALID_CREDENTIALS = 'E-mail ou senha incorretos.';

function cookiesOf(res: request.Response): string[] {
  const header = res.headers['set-cookie'] as unknown;
  return Array.isArray(header) ? (header as string[]) : [];
}

describe('POST /auth/login (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;

  const post = (path: string, body: object, ip = uniqueIp()) =>
    request(app.getHttpServer())
      .post(path)
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', ip)
      .send(body);
  const login = (body: object, ip?: string) => post('/auth/login', body, ip);

  const eventsOf = async (email: string): Promise<string[]> => {
    const rows: Array<{ event: string }> = await db.query(
      `SELECT a.event FROM audit_logs a JOIN users u ON u.id = a.user_id
       WHERE u.email = $1 ORDER BY a.created_at`,
      [email],
    );
    return rows.map((row) => row.event);
  };

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DataSource);
    await post('/auth/register', account).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('entra com e-mail em outra caixa e abre a sessão nos cookies', async () => {
    const res = await login({
      email: '  CARLA@example.com ',
      password: account.password,
    }).expect(200);

    expect(res.body.user).toEqual({
      id: expect.any(String),
      name: account.name,
      email: account.email,
      createdAt: expect.any(String),
    });
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash/i);
    expect(res.headers['cache-control']).toBe('no-store');

    const cookies = cookiesOf(res);
    expect(cookies.some((c) => c.startsWith('__Host-kora_at='))).toBe(true);
    expect(cookies.some((c) => c.startsWith('__Secure-kora_rt='))).toBe(true);
    expect(await eventsOf(account.email)).toContain('LOGIN_SUCCESS');
  });

  it('devolve a mesma resposta para senha errada e e-mail inexistente', async () => {
    const wrongPassword = await login({
      email: account.email,
      password: 'senha errada mas bem comprida',
    }).expect(401);
    const unknownEmail = await login({
      email: 'ninguem@example.com',
      password: account.password,
    }).expect(401);

    expect(wrongPassword.body.message).toBe(INVALID_CREDENTIALS);
    expect(unknownEmail.body.message).toBe(INVALID_CREDENTIALS);
    expect(cookiesOf(wrongPassword)).toHaveLength(0);
    expect(cookiesOf(unknownEmail)).toHaveLength(0);
  });

  it('zera o contador de falhas depois de um login certo', async () => {
    await login({ email: account.email, password: account.password }).expect(
      200,
    );
    const [user] = await db.query(
      `SELECT failed_login_count FROM users WHERE email = $1`,
      [account.email],
    );
    expect(user.failed_login_count).toBe(0);
  });

  it('trava a conta após 5 falhas seguidas, mesmo com a senha certa', async () => {
    const email = 'travada@example.com';
    await post('/auth/register', { ...account, email }).expect(201);

    for (let i = 0; i < 5; i++) {
      await login({ email, password: 'senha errada mas bem comprida' }).expect(
        401,
      );
    }
    const res = await login({ email, password: account.password }).expect(401);

    expect(res.body.message).toBe(INVALID_CREDENTIALS);
    const [user] = await db.query(
      `SELECT locked_until FROM users WHERE email = $1`,
      [email],
    );
    expect(new Date(user.locked_until).getTime()).toBeGreaterThan(Date.now());
    expect(await eventsOf(email)).toContain('ACCOUNT_LOCKED');
  });

  it('libera a conta quando o bloqueio expira', async () => {
    const email = 'travada@example.com';
    await db.query(
      `UPDATE users SET locked_until = now() - interval '1 minute' WHERE email = $1`,
      [email],
    );
    await login({ email, password: account.password }).expect(200);
  });

  it.each([
    [{ email: 'nao-e-email', password: account.password }, 'email'],
    [{ email: account.email, password: '' }, 'password'],
    [{ email: account.email, password: 'x'.repeat(129) }, 'password'],
  ])('valida a entrada e devolve 400 (%#)', async (body, field) => {
    const res = await login(body).expect(400);
    expect(res.body.issues.map((i: { path: string }) => i.path)).toContain(
      field,
    );
  });

  it('bloqueia login vindo de outra origem (CSRF)', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: account.email, password: account.password })
      .expect(403);
  });

  it('limita tentativas por IP', async () => {
    const ip = '203.0.113.9';
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await login(
        { email: `rl${i}@example.com`, password: account.password },
        ip,
      );
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('migra contas antigas de scrypt para Argon2id no primeiro login', async () => {
    const email = 'legado@example.com';
    await db.query(
      `INSERT INTO users (name, email, password_hash, password_changed_at)
       VALUES ('Conta Legada', $1, $2, now())`,
      [email, legacyScryptHash(account.password)],
    );

    await login({ email, password: account.password }).expect(200);

    const [user] = await db.query(
      `SELECT password_hash FROM users WHERE email = $1`,
      [email],
    );
    expect(user.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    // E a senha continua funcionando com o hash novo.
    await login({ email, password: account.password }).expect(200);
  });
});
