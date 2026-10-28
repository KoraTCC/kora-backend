import type { MailMessage } from '../mail/mail.service.js';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

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
    html: `<p>Olá, ${safeName}.</p>
<p>Recebemos um pedido para redefinir a senha da sua conta na Kora.</p>
<p><a href="${escapeHtml(link)}">Criar nova senha</a> (válido por 30 minutos)</p>
<p>Se não foi você, ignore este e-mail: sua senha continua a mesma.</p>`,
  };
}

export function passwordChangedEmail(to: string, name: string): MailMessage {
  return {
    to,
    subject: 'Sua senha da Kora foi alterada',
    text: [
      `Olá, ${name}.`,
      '',
      'A senha da sua conta na Kora acabou de ser alterada e todas as sessões foram encerradas.',
      'Se não foi você, redefina a senha imediatamente e fale com o suporte.',
    ].join('\n'),
    html: `<p>Olá, ${escapeHtml(name)}.</p>
<p>A senha da sua conta na Kora acabou de ser alterada e todas as sessões foram encerradas.</p>
<p>Se não foi você, redefina a senha imediatamente e fale com o suporte.</p>`,
  };
}
