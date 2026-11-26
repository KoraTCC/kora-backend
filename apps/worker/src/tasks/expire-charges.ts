import type { DataSource } from 'typeorm';

/**
 * Marca como expiradas as cobranças pendentes cujo prazo passou. Idempotente:
 * rodar duas vezes (ou em dois workers ao mesmo tempo) dá o mesmo resultado.
 * Devolve quantas cobranças expiraram.
 */
export async function expireOverdueCharges(
  dataSource: DataSource,
): Promise<number> {
  // `WITH … SELECT`: para UPDATE o `query()` do TypeORM devolveria
  // `[linhas, quantidade]`; assim volta uma linha só, com a contagem.
  const [row] = await dataSource.query<Array<{ count: number }>>(
    `WITH expired AS (
       UPDATE charges SET status = 'expired', updated_at = now()
        WHERE status = 'pending' AND expires_at < now()
       RETURNING id
     )
     SELECT count(*)::int AS count FROM expired`,
  );
  return row?.count ?? 0;
}
