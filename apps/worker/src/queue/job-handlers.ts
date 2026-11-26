import { SEND_EMAIL_JOB } from '@kora/database';
import nodemailer from 'nodemailer';
import type { Env } from '../config/env.js';
import { createSendEmailHandler } from '../jobs/send-email.js';
import type { JobDefinition, JobHandler } from './job-runner.js';

/** Token de injeção do mapa `tipo do job → handler`. */
export const JOB_HANDLERS = Symbol('JOB_HANDLERS');

/** Handlers registrados. Um tipo novo de job (webhooks...) entra aqui. */
export function buildJobHandlers(
  env: Env,
): Map<string, JobHandler | JobDefinition> {
  const smtp = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER
      ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' }
      : undefined,
  });
  return new Map<string, JobHandler | JobDefinition>([
    [SEND_EMAIL_JOB, createSendEmailHandler(smtp, env.MAIL_FROM)],
  ]);
}
