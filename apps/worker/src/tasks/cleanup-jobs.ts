import type { DataSource } from 'typeorm';

/**
 * A fila não cresce para sempre: jobs concluídos somem depois de 7 dias e os
 * que falharam de vez depois de 30 (tempo para alguém investigar).
 */
export async function cleanupFinishedJobs(
  dataSource: DataSource,
): Promise<number> {
  const rows = await dataSource.query<Array<{ id: string }>>(
    `DELETE FROM jobs
      WHERE (status = 'done' AND finished_at < now() - interval '7 days')
         OR (status = 'failed' AND finished_at < now() - interval '30 days')
      RETURNING id`,
  );
  return rows.length;
}
