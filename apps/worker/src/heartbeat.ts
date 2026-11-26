import { writeFile } from 'node:fs/promises';

/**
 * O worker não tem HTTP para o Docker perguntar "está vivo?". Em vez disso,
 * ele grava o horário num arquivo a cada ciclo, e o healthcheck do compose
 * confere se o arquivo foi atualizado há pouco.
 */
export async function beat(file: string): Promise<void> {
  await writeFile(file, String(Date.now()));
}
