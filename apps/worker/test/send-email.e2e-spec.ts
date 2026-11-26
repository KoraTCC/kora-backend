import { enqueueJob, SEND_EMAIL_JOB } from '@kora/database';
import type { DataSource } from 'typeorm';
import {
  createSendEmailHandler,
  type MailTransport,
} from '../src/jobs/send-email.js';
import { JobRunner } from '../src/queue/job-runner.js';
import { createTestDataSource } from './database.js';

const FROM = 'Kora <nao-responda@korapag.com>';
const MESSAGE = {
  to: 'pessoa@example.com',
  subject: 'Redefinir senha',
  text: 'Link: https://app.korapag.com/reset-password?token=segredo',
  html: '<a href="https://app.korapag.com/reset-password?token=segredo">ok</a>',
};

describe('Job send_email (e2e)', () => {
  let db: DataSource;

  const runner = (transport: MailTransport) =>
    new JobRunner(
      db,
      new Map([[SEND_EMAIL_JOB, createSendEmailHandler(transport, FROM)]]),
      { batchSize: 10, lockSeconds: 60 },
    );
  const row = async (id: string) =>
    (
      await db.query<
        Array<{ status: string; attempts: number; payload: object }>
      >(`SELECT status, attempts, payload FROM jobs WHERE id = $1`, [id])
    )[0]!;

  beforeAll(async () => {
    db = await createTestDataSource();
  });

  beforeEach(async () => {
    await db.query('DELETE FROM jobs');
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('envia com o remetente do worker e apaga o payload (link do reset)', async () => {
    const sent: unknown[] = [];
    const id = await enqueueJob(db.manager, SEND_EMAIL_JOB, MESSAGE);

    await runner({
      sendMail: async (message) => void sent.push(message),
    }).runOnce();

    expect(sent).toEqual([{ from: FROM, ...MESSAGE }]);
    expect(await row(id)).toEqual({ status: 'done', attempts: 1, payload: {} });
  });

  it('SMTP fora do ar: reagenda e mantém o payload para tentar de novo', async () => {
    const id = await enqueueJob(db.manager, SEND_EMAIL_JOB, MESSAGE);

    await runner({
      sendMail: () => Promise.reject(new Error('ECONNREFUSED')),
    }).runOnce();

    expect(await row(id)).toEqual({
      status: 'pending',
      attempts: 1,
      payload: MESSAGE,
    });
  });

  it('falhou de vez: também apaga o payload', async () => {
    const id = await enqueueJob(db.manager, SEND_EMAIL_JOB, MESSAGE, {
      maxAttempts: 1,
    });

    await runner({
      sendMail: () => Promise.reject(new Error('ECONNREFUSED')),
    }).runOnce();

    expect(await row(id)).toEqual({
      status: 'failed',
      attempts: 1,
      payload: {},
    });
  });

  it('payload inválido não chama o SMTP', async () => {
    const sent: unknown[] = [];
    const id = await enqueueJob(
      db.manager,
      SEND_EMAIL_JOB,
      { to: 'x' },
      {
        maxAttempts: 1,
      },
    );

    await runner({
      sendMail: async (message) => void sent.push(message),
    }).runOnce();

    expect(sent).toEqual([]);
    expect((await row(id)).status).toBe('failed');
  });
});
