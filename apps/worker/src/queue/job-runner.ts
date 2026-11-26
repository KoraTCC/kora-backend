import type { JobPayload } from '@kora/database';
import type { DataSource } from 'typeorm';
import { backoffSeconds } from './backoff.js';

export interface ClaimedJob {
  id: string;
  type: string;
  payload: JobPayload;
  /** Tentativas que já falharam antes desta. */
  attempts: number;
  maxAttempts: number;
}

/** Executa um tipo de job. Lançar erro = falhou, a fila tenta de novo. */
export type JobHandler = (job: ClaimedJob) => Promise<void>;

export interface JobRunnerOptions {
  batchSize: number;
  lockSeconds: number;
  /** Chamado em cada job concluído ou com erro (logs, métricas). */
  onResult?: (
    job: ClaimedJob,
    outcome: 'done' | 'retry' | 'failed',
    error?: unknown,
  ) => void;
}

const MAX_ERROR_LENGTH = 1_000;

function describeError(error: unknown): string {
  const text =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.slice(0, MAX_ERROR_LENGTH);
}

/**
 * Consome a tabela `jobs`. Entrega "pelo menos uma vez": se o processo morrer
 * depois de executar e antes de marcar `done`, o job roda de novo quando a
 * reserva vencer. Por isso todo handler precisa ser idempotente.
 */
export class JobRunner {
  constructor(
    private readonly dataSource: DataSource,
    private readonly handlers: ReadonlyMap<string, JobHandler>,
    private readonly options: JobRunnerOptions,
  ) {}

  /** Reserva e processa um lote. Devolve quantos jobs pegou. */
  async runOnce(): Promise<number> {
    const jobs = await this.claim();
    for (const job of jobs) await this.process(job);
    return jobs.length;
  }

  /**
   * Reserva até `batchSize` jobs prontos. `FOR UPDATE SKIP LOCKED` faz cada
   * worker pegar linhas diferentes, sem esperar nem duplicar; `locked_until`
   * devolve o job à fila se este worker morrer no meio.
   */
  private async claim(): Promise<ClaimedJob[]> {
    const rows = await this.dataSource.query<
      Array<{
        id: string;
        type: string;
        payload: JobPayload;
        attempts: number;
        max_attempts: number;
      }>
    >(
      `UPDATE jobs SET locked_until = now() + make_interval(secs => $2), updated_at = now()
        WHERE id IN (
          SELECT id FROM jobs
           WHERE status = 'pending' AND run_at <= now()
             AND (locked_until IS NULL OR locked_until < now())
           ORDER BY run_at
           LIMIT $1
           FOR UPDATE SKIP LOCKED)
        RETURNING id, type, payload, attempts, max_attempts`,
      [this.options.batchSize, this.options.lockSeconds],
    );
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      payload: row.payload,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
    }));
  }

  private async process(job: ClaimedJob): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      // Tipo desconhecido não melhora tentando de novo: falha de vez.
      await this.finish(job, 'failed', `Tipo de job desconhecido: ${job.type}`);
      this.options.onResult?.(job, 'failed');
      return;
    }
    try {
      await handler(job);
      await this.finish(job, 'done', null);
      this.options.onResult?.(job, 'done');
    } catch (error) {
      const failedAttempts = job.attempts + 1;
      if (failedAttempts >= job.maxAttempts) {
        await this.finish(job, 'failed', describeError(error));
        this.options.onResult?.(job, 'failed', error);
      } else {
        await this.dataSource.query(
          `UPDATE jobs SET attempts = $2, last_error = $3, locked_until = NULL,
                  run_at = now() + make_interval(secs => $4), updated_at = now()
            WHERE id = $1`,
          [
            job.id,
            failedAttempts,
            describeError(error),
            backoffSeconds(failedAttempts),
          ],
        );
        this.options.onResult?.(job, 'retry', error);
      }
    }
  }

  private async finish(
    job: ClaimedJob,
    status: 'done' | 'failed',
    lastError: string | null,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE jobs SET status = $2, attempts = attempts + 1, last_error = $3,
              locked_until = NULL, finished_at = now(), updated_at = now()
        WHERE id = $1`,
      [job.id, status, lastError],
    );
  }
}
