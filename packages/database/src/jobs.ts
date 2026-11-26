import type { EntityManager } from 'typeorm';
import type { JobPayload } from './entities/job.entity.js';

export interface EnqueueOptions {
  /** Executar só a partir deste instante (padrão: agora). */
  runAt?: Date;
  maxAttempts?: number;
}

/**
 * Coloca um trabalho na fila. Recebe o `EntityManager` de quem chama para
 * entrar na MESMA transação (padrão outbox): se a mudança for desfeita, o
 * job também some; se ela for gravada, o job com certeza existe.
 */
export async function enqueueJob(
  manager: EntityManager,
  type: string,
  payload: JobPayload,
  options: EnqueueOptions = {},
): Promise<string> {
  // SQL direto: o tipo recursivo do payload é fundo demais para o
  // DeepPartial do repositório. Parâmetros ($n) evitam injeção.
  const [row] = await manager.query<Array<{ id: string }>>(
    `INSERT INTO jobs (type, payload, run_at, max_attempts)
     VALUES ($1, $2::jsonb, coalesce($3, now()), coalesce($4, 6))
     RETURNING id`,
    [
      type,
      JSON.stringify(payload),
      options.runAt ?? null,
      options.maxAttempts ?? null,
    ],
  );
  return row!.id;
}

/** Tipo do job de e-mail: a API enfileira, o worker envia por SMTP. */
export const SEND_EMAIL_JOB = 'send_email';

/** Mensagem pronta (o remetente é decidido pelo worker, `MAIL_FROM`). */
export type SendEmailPayload = {
  to: string;
  subject: string;
  text: string;
  html: string;
};
