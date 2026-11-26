import { existsSync } from 'node:fs';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  DATABASE_URL: z.url(),

  /** Intervalo entre buscas na fila quando ela está vazia. */
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1_000),
  /** Quantos jobs reservar por vez. */
  WORKER_BATCH_SIZE: z.coerce.number().int().positive().default(10),
  /** Reserva de um job: vencida, outro worker pode pegar (o atual morreu). */
  WORKER_LOCK_SECONDS: z.coerce.number().int().positive().default(60),
  WORKER_EXPIRE_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  WORKER_CLEANUP_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(3_600_000),
  /** Atualizado a cada ciclo; o healthcheck do Docker olha a idade dele. */
  WORKER_HEARTBEAT_FILE: z.string().min(1).default('/tmp/worker-heartbeat'),
});

export type Env = z.infer<typeof envSchema>;

export const ENV = Symbol('ENV');

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (source === process.env && existsSync('.env')) {
    process.loadEnvFile('.env');
  }
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
  }
  return parsed.data;
}
