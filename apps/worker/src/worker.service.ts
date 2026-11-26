import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { setTimeout as sleep } from 'node:timers/promises';
import { DataSource } from 'typeorm';
import { ENV, type Env } from './config/env.js';
import { beat } from './heartbeat.js';
import { JOB_HANDLERS } from './queue/job-handlers.js';
import { JobRunner, type JobHandlers } from './queue/job-runner.js';
import { cleanupFinishedJobs } from './tasks/cleanup-jobs.js';
import { expireOverdueCharges } from './tasks/expire-charges.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : JSON.stringify(error);
}

interface PeriodicTask {
  name: string;
  intervalMs: number;
  run: () => Promise<number>;
}

/** Liga a fila e as tarefas periódicas quando o app sobe; desliga com calma. */
@Injectable()
export class WorkerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(WorkerService.name);
  private readonly runner: JobRunner;
  private readonly tasks: PeriodicTask[];
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly running = new Set<string>();
  private stopping = false;
  private loop?: Promise<void>;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly dataSource: DataSource,
    @Inject(JOB_HANDLERS) handlers: JobHandlers,
  ) {
    this.runner = new JobRunner(dataSource, handlers, {
      batchSize: env.WORKER_BATCH_SIZE,
      lockSeconds: env.WORKER_LOCK_SECONDS,
      onResult: (job, outcome, error) => {
        const message = `job ${job.type} ${job.id}: ${outcome}`;
        if (outcome === 'done') this.logger.log(message);
        else
          this.logger.warn(
            error ? `${message}: ${errorMessage(error)}` : message,
          );
      },
    });
    this.tasks = [
      {
        name: 'expire-charges',
        intervalMs: env.WORKER_EXPIRE_INTERVAL_MS,
        run: () => expireOverdueCharges(dataSource),
      },
      {
        name: 'cleanup-jobs',
        intervalMs: env.WORKER_CLEANUP_INTERVAL_MS,
        run: () => cleanupFinishedJobs(dataSource),
      },
    ];
  }

  onApplicationBootstrap(): void {
    for (const task of this.tasks) {
      void this.runTask(task);
      this.timers.push(
        setInterval(() => void this.runTask(task), task.intervalMs),
      );
    }
    this.loop = this.pollQueue();
    this.logger.log('Worker no ar: fila e tarefas periódicas ativas.');
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    for (const timer of this.timers) clearInterval(timer);
    // Termina o lote atual antes de fechar a conexão com o banco.
    await this.loop;
  }

  private async pollQueue(): Promise<void> {
    while (!this.stopping) {
      let claimed = 0;
      try {
        claimed = await this.runner.runOnce();
        await beat(this.env.WORKER_HEARTBEAT_FILE);
      } catch (error) {
        this.logger.error(`Falha ao processar a fila: ${errorMessage(error)}`);
      }
      // Fila com trabalho: busca de novo na hora. Vazia: espera o intervalo.
      if (claimed === 0 && !this.stopping) {
        await sleep(this.env.WORKER_POLL_INTERVAL_MS);
      }
    }
  }

  /** Uma execução por vez de cada tarefa, mesmo se o intervalo for curto. */
  private async runTask(task: PeriodicTask): Promise<void> {
    if (this.running.has(task.name) || this.stopping) return;
    this.running.add(task.name);
    try {
      const affected = await task.run();
      if (affected > 0)
        this.logger.log(`${task.name}: ${affected} registro(s)`);
    } catch (error) {
      this.logger.error(`${task.name} falhou: ${errorMessage(error)}`);
    } finally {
      this.running.delete(task.name);
    }
  }
}
