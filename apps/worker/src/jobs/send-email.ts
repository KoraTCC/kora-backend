import type { SendEmailPayload } from '@kora/database';
import { z } from 'zod';
import type { JobDefinition } from '../queue/job-runner.js';

/** O mínimo do nodemailer que o handler usa (facilita o teste). */
export interface MailTransport {
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<unknown>;
}

const payloadSchema = z.object({
  to: z.email(),
  subject: z.string().min(1),
  text: z.string(),
  html: z.string(),
}) satisfies z.ZodType<SendEmailPayload>;

/**
 * Envia o e-mail que a API enfileirou. O payload é limpo ao terminar: o
 * e-mail de reset traz o link com o token, que não deve ficar no banco.
 *
 * Entrega "pelo menos uma vez": se o worker morrer entre o envio e o `done`,
 * o e-mail sai de novo. É raro e aceitável (o destinatário recebe duplicado).
 */
export function createSendEmailHandler(
  transport: MailTransport,
  from: string,
): JobDefinition {
  return {
    clearPayloadOnFinish: true,
    run: async (job) => {
      const message = payloadSchema.parse(job.payload);
      await transport.sendMail({ from, ...message });
    },
  };
}
