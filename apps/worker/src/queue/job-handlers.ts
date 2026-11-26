import type { JobHandler } from './job-runner.js';

/** Token de injeção do mapa `tipo do job → handler`. */
export const JOB_HANDLERS = Symbol('JOB_HANDLERS');

/**
 * Handlers registrados. Começa vazio: os tipos de job (e-mail, webhooks)
 * entram aqui conforme forem criados.
 */
export function buildJobHandlers(): Map<string, JobHandler> {
  return new Map<string, JobHandler>();
}
