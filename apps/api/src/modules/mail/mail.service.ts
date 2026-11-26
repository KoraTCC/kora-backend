import {
  enqueueJob,
  SEND_EMAIL_JOB,
  type SendEmailPayload,
} from '@kora/database';
import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

export type MailMessage = SendEmailPayload;

/**
 * A API não envia e-mail: ela coloca o e-mail na fila e o `apps/worker`
 * envia por SMTP, com retentativa. Passe o `manager` da transação para o
 * e-mail ser gravado junto com a mudança que o gerou (padrão outbox): se a
 * transação for desfeita, o e-mail não sai; se for gravada, com certeza sai.
 */
@Injectable()
export class MailService {
  constructor(private readonly dataSource: DataSource) {}

  async queue(message: MailMessage, manager?: EntityManager): Promise<void> {
    await enqueueJob(
      manager ?? this.dataSource.manager,
      SEND_EMAIL_JOB,
      message,
    );
  }
}
