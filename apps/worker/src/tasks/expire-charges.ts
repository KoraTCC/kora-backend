import type { DataSource } from 'typeorm';

/**
 * Marca como expiradas as cobranças pendentes cujo prazo passou. Idempotente:
 * rodar duas vezes (ou em dois workers ao mesmo tempo) dá o mesmo resultado.
 * Devolve quantas cobranças expiraram.
 */
export async function expireOverdueCharges(
  dataSource: DataSource,
): Promise<number> {
  const rows = await dataSource.query<Array<{ id: string }>>(
    `UPDATE charges SET status = 'expired', updated_at = now()
      WHERE status = 'pending' AND expires_at < now()
      RETURNING id`,
  );
  return rows.length;
}
