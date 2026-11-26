/** Espera antes de cada nova tentativa: 30 s, 2 min, 10 min, 1 h, 6 h… */
const BACKOFF_SECONDS = [30, 120, 600, 3_600, 21_600];

/** `attempt`: quantas tentativas já falharam (1 = a primeira). */
export function backoffSeconds(attempt: number): number {
  const index = Math.min(Math.max(attempt, 1), BACKOFF_SECONDS.length) - 1;
  return BACKOFF_SECONDS[index]!;
}
