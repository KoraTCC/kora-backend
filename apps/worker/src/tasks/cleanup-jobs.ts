import type { DataSource } from 'typeorm';

/**
 * A fila não cresce para sempre: jobs concluídos somem depois de 7 dias e os
 * que falharam de vez depois de 30 (tempo para alguém investigar).
 */
export async function cleanupFinishedJobs(
  dataSource: DataSource,
): Promise<number> {
  const [row] = await dataSource.query<Array<{ count: number }>>(
    `WITH removed AS (
       DELETE FROM jobs
        WHERE (status = 'done' AND finished_at < now() - interval '7 days')
           OR (status = 'failed' AND finished_at < now() - interval '30 days')
       RETURNING id
     )
     SELECT count(*)::int AS count FROM removed`,
  );
  return row?.count ?? 0;
}
