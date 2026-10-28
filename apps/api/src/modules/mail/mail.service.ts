import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { ENV, type Env } from '../../config/env.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(@Inject(ENV) env: Env) {
    this.from = env.MAIL_FROM;
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' }
        : undefined,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.from, ...message });
  }

  /**
   * Envia sem fazer a requisição esperar. Usado onde o tempo de resposta não
   * pode revelar nada (ex.: "esqueceu a senha" não pode demorar mais quando
   * o e-mail existe). Falhas vão para o log, sem o conteúdo da mensagem.
   */
  sendInBackground(message: MailMessage): void {
    this.send(message).catch((error: unknown) => {
      this.logger.error(
        `Falha ao enviar e-mail "${message.subject}": ${String(error)}`,
      );
    });
  }
}
