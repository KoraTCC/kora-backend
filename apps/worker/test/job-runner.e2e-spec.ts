import { enqueueJob } from '@kora/database';
import type { DataSource } from 'typeorm';
import { JobRunner, type JobHandler } from '../src/queue/job-runner.js';
import { createTestDataSource } from './database.js';

interface JobRow {
  status: string;
  attempts: number;
  last_error: string | null;
  run_at: Date;
  locked_until: Date | null;
  finished_at: Date | null;
}

describe('JobRunner (e2e)', () => {
  let db: DataSource;

  const runner = (handlers: Record<string, JobHandler>, batchSize = 10) =>
    new JobRunner(db, new Map(Object.entries(handlers)), {
      batchSize,
      lockSeconds: 60,
    });
  const enqueue = (type: string, payload = {}, maxAttempts?: number) =>
    enqueueJob(db.manager, type, payload, maxAttempts ? { maxAttempts } : {});
  const row = async (id: string): Promise<JobRow> =>
    (await db.query(`SELECT * FROM jobs WHERE id = $1`, [id]))[0];
  /** Antecipa um job reagendado, para não esperar o backoff no teste. */
  const makeDue = (id: string) =>
    db.query(
      `UPDATE jobs SET run_at = now() - interval '1 second' WHERE id = $1`,
      [id],
    );

  beforeAll(async () => {
    db = await createTestDataSource();
  });

  beforeEach(async () => {
    await db.query('DELETE FROM jobs');
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('executa o handler com o payload e marca como done', async () => {
    const seen: unknown[] = [];
    const id = await enqueue('ping', { valor: 42 });

    expect(
      await runner({
        ping: async (job) => void seen.push(job.payload),
      }).runOnce(),
    ).toBe(1);

    expect(seen).toEqual([{ valor: 42 }]);
    expect(await row(id)).toMatchObject({
      status: 'done',
      attempts: 1,
      locked_until: null,
    });
    expect((await row(id)).finished_at).not.toBeNull();
  });

  it('falha → reagenda com backoff e guarda o erro', async () => {
    const id = await enqueue('instavel');
    const before = Date.now();

    await runner({
      instavel: () => Promise.reject(new Error('SMTP fora do ar')),
    }).runOnce();

    const job = await row(id);
    expect(job).toMatchObject({
      status: 'pending',
      attempts: 1,
      locked_until: null,
    });
    expect(job.last_error).toContain('SMTP fora do ar');
    // Primeira falha: tenta de novo em 30 s.
    expect(new Date(job.run_at).getTime() - before).toBeGreaterThanOrEqual(
      29_000,
    );

    // Ainda não está na hora: não é pego de novo.
    expect(await runner({ instavel: async () => {} }).runOnce()).toBe(0);
  });

  it('esgotou as tentativas → failed', async () => {
    const id = await enqueue('quebrado', {}, 2);
    const failing = runner({
      quebrado: () => Promise.reject(new Error('sempre falha')),
    });

    await failing.runOnce();
    expect((await row(id)).status).toBe('pending');
    await makeDue(id);
    await failing.runOnce();

    expect(await row(id)).toMatchObject({ status: 'failed', attempts: 2 });
  });

  it('tipo desconhecido falha de vez, sem tentar de novo', async () => {
    const id = await enqueue('nao_existe');
    await runner({}).runOnce();
    const job = await row(id);
    expect(job.status).toBe('failed');
    expect(job.last_error).toContain('desconhecido');
  });

  it('dois workers em paralelo nunca processam o mesmo job', async () => {
    for (let i = 0; i < 30; i++) await enqueue('contar', { i });
    const processed: number[] = [];
    const handler: JobHandler = async (job) => {
      processed.push(job.payload.i as number);
      await new Promise((resolve) => setTimeout(resolve, 5));
    };
    const a = runner({ contar: handler }, 5);
    const b = runner({ contar: handler }, 5);

    // Os dois disputam a fila ao mesmo tempo até ela esvaziar.
    const drain = async (r: JobRunner) => {
      while ((await r.runOnce()) > 0);
    };
    await Promise.all([drain(a), drain(b)]);

    expect(processed).toHaveLength(30);
    expect(new Set(processed).size).toBe(30);
  });

  it('retoma job de um worker que morreu (reserva vencida)', async () => {
    const id = await enqueue('orfao');
    // Simula um worker que reservou e morreu antes de terminar.
    await db.query(
      `UPDATE jobs SET locked_until = now() - interval '1 second' WHERE id = $1`,
      [id],
    );
    let ran = false;
    await runner({ orfao: async () => void (ran = true) }).runOnce();
    expect(ran).toBe(true);
    expect((await row(id)).status).toBe('done');
  });

  it('não pega job reservado por outro worker ainda vivo', async () => {
    const id = await enqueue('ocupado');
    await db.query(
      `UPDATE jobs SET locked_until = now() + interval '60 seconds' WHERE id = $1`,
      [id],
    );
    expect(await runner({ ocupado: async () => {} }).runOnce()).toBe(0);
  });

  it('job enfileirado numa transação desfeita não existe', async () => {
    await expect(
      db.transaction(async (manager) => {
        await enqueueJob(manager, 'fantasma', {});
        throw new Error('a mudança deu errado');
      }),
    ).rejects.toThrow();
    expect((await db.query(`SELECT count(*)::int AS n FROM jobs`))[0].n).toBe(
      0,
    );
  });
});
