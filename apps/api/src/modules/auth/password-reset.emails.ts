import { escapeHtml, renderEmail } from '../mail/email-layout.js';
import type { MailMessage } from '../mail/mail.service.js';

export function passwordResetEmail(
  to: string,
  name: string,
  link: string,
): MailMessage {
  const safeName = escapeHtml(name);
  return {
    to,
    subject: 'Redefinir sua senha da Kora',
    text: [
      `Olá, ${name}.`,
      '',
      'Recebemos um pedido para redefinir a senha da sua conta na Kora.',
      `Use este link nos próximos 30 minutos: ${link}`,
      '',
      'Se não foi você, ignore este e-mail: sua senha continua a mesma.',
    ].join('\n'),
    html: renderEmail({
      preheader:
        'Use o link para criar uma nova senha. Ele vale por 30 minutos.',
      title: 'Redefinir sua senha',
      paragraphs: [
        `Olá, ${safeName}.`,
        'Recebemos um pedido para redefinir a senha da sua conta na Kora. Clique no botão abaixo para criar uma nova senha.',
        'O link vale por <strong>30 minutos</strong> e só pode ser usado uma vez.',
      ],
      button: { label: 'Criar nova senha', url: link },
      footnote:
        'Não pediu para redefinir a senha? Ignore este e-mail: sua senha continua a mesma e ninguém consegue alterá-la sem este link.',
    }),
  };
}

export function passwordChangedEmail(
  to: string,
  name: string,
  forgotPasswordUrl: string,
): MailMessage {
  return {
    to,
    subject: 'Sua senha da Kora foi alterada',
    text: [
      `Olá, ${name}.`,
      '',
      'A senha da sua conta na Kora acabou de ser alterada e todas as sessões foram encerradas.',
      `Se não foi você, redefina a senha agora: ${forgotPasswordUrl}`,
    ].join('\n'),
    html: renderEmail({
      preheader: 'Se não foi você, redefina a senha imediatamente.',
      title: 'Sua senha foi alterada',
      paragraphs: [
        `Olá, ${escapeHtml(name)}.`,
        'A senha da sua conta na Kora acabou de ser alterada. Por segurança, <strong>todas as sessões foram encerradas</strong>: entre de novo com a nova senha.',
      ],
      footnote: `Não foi você? <a href="${escapeHtml(forgotPasswordUrl)}" style="color:#0e110e;">Redefina a senha agora</a> e verifique a segurança do seu e-mail.`,
    }),
  };
}
