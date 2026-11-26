import type { DataSource } from 'typeorm';
import { cleanupFinishedJobs } from '../src/tasks/cleanup-jobs.js';
import { expireOverdueCharges } from '../src/tasks/expire-charges.js';
import { createTestDataSource } from './database.js';

describe('Tarefas periódicas (e2e)', () => {
  let db: DataSource;

  /** Loja com carteira, para poder criar cobranças direto no banco. */
  async function merchantWithWallet(): Promise<{
    merchantId: string;
    walletId: string;
  }> {
    const [user] = await db.query(
      `INSERT INTO users (name, email, password_hash, password_changed_at)
       VALUES ('Loja', $1, 'x', now()) RETURNING id`,
      [`loja-${Date.now()}-${Math.random()}@example.com`],
    );
    const [merchant] = await db.query(
      `INSERT INTO merchants (user_id, name, display_name) VALUES ($1, 'Loja', 'Loja') RETURNING id`,
      [user.id],
    );
    const [wallet] = await db.query(
      `INSERT INTO wallets (merchant_id, address, network, is_default)
       VALUES ($1, '0x7a3f9b2c4e81d5a6b0c9e2f1a4d3c8b7e6f5d419', 'sepolia', true) RETURNING id`,
      [merchant.id],
    );
    return { merchantId: merchant.id, walletId: wallet.id };
  }

  async function charge(status: string, expiresIn: string): Promise<string> {
    const { merchantId, walletId } = await merchantWithWallet();
    const [row] = await db.query(
      `INSERT INTO charges (merchant_id, wallet_id, reference, origin, amount_cents, crypto_amount,
                            asset, network, address, status, required_confirmations,
                            locked_rate_cents, expires_at)
       VALUES ($1, $2, 'PED', 'payment-link', 10000, 0.0074, 'ETH', 'sepolia',
               '0x7a3f9b2c4e81d5a6b0c9e2f1a4d3c8b7e6f5d419', $3, 12, 1353260,
               now() + $4::interval)
       RETURNING id`,
      [merchantId, walletId, status, expiresIn],
    );
    return row.id;
  }

  const statusOf = async (id: string): Promise<string> =>
    (await db.query(`SELECT status FROM charges WHERE id = $1`, [id]))[0]
      .status;

  beforeAll(async () => {
    db = await createTestDataSource();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('expira só as cobranças pendentes que passaram do prazo', async () => {
    const overdue = await charge('pending', '-1 minute');
    const stillOpen = await charge('pending', '10 minutes');
    const confirmedLate = await charge('confirmed', '-1 minute');

    expect(await expireOverdueCharges(db)).toBeGreaterThanOrEqual(1);

    expect(await statusOf(overdue)).toBe('expired');
    expect(await statusOf(stillOpen)).toBe('pending');
    expect(await statusOf(confirmedLate)).toBe('confirmed');

    // Idempotente: rodar de novo não muda nada.
    expect(await expireOverdueCharges(db)).toBe(0);
  });

  it('limpa jobs concluídos antigos e mantém os recentes', async () => {
    await db.query(`DELETE FROM jobs`);
    await db.query(
      `INSERT INTO jobs (type, status, finished_at) VALUES
         ('velho', 'done', now() - interval '8 days'),
         ('recente', 'done', now() - interval '1 day'),
         ('falhou-recente', 'failed', now() - interval '8 days'),
         ('pendente', 'pending', NULL)`,
    );
    expect(await cleanupFinishedJobs(db)).toBe(1);
    const left = (await db.query(`SELECT type FROM jobs ORDER BY type`)).map(
      (r: { type: string }) => r.type,
    );
    expect(left).toEqual(['falhou-recente', 'pendente', 'recente']);
  });
});
