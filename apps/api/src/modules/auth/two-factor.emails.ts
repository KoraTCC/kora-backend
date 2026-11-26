import { escapeHtml, renderEmail } from '../mail/email-layout.js';
import type { MailMessage } from '../mail/mail.service.js';

export function twoFactorEnabledEmail(to: string, name: string): MailMessage {
  return {
    to,
    subject: 'Verificação em duas etapas ativada na Kora',
    text: [
      `Olá, ${name}.`,
      '',
      'A verificação em duas etapas foi ativada na sua conta da Kora.',
      'A partir de agora, além da senha, o login pede o código do seu app autenticador.',
      'Guarde os códigos de recuperação em um lugar seguro.',
    ].join('\n'),
    html: renderEmail({
      preheader:
        'Além da senha, o login agora pede o código do app autenticador.',
      title: 'Verificação em duas etapas ativada',
      paragraphs: [
        `Olá, ${escapeHtml(name)}.`,
        'A verificação em duas etapas foi <strong>ativada</strong> na sua conta. A partir de agora, além da senha, o login pede o código do seu app autenticador.',
        'Guarde os códigos de recuperação em um lugar seguro: são eles que liberam o acesso se você perder o celular.',
      ],
      footnote:
        'Não foi você? Alguém com a sua senha está usando a conta: redefina a senha imediatamente.',
    }),
  };
}

export function twoFactorDisabledEmail(to: string, name: string): MailMessage {
  return {
    to,
    subject: 'Verificação em duas etapas desativada na Kora',
    text: [
      `Olá, ${name}.`,
      '',
      'A verificação em duas etapas foi desativada na sua conta da Kora.',
      'Se não foi você, redefina a senha imediatamente.',
    ].join('\n'),
    html: renderEmail({
      preheader: 'Se não foi você, redefina a senha imediatamente.',
      title: 'Verificação em duas etapas desativada',
      paragraphs: [
        `Olá, ${escapeHtml(name)}.`,
        'A verificação em duas etapas foi <strong>desativada</strong> na sua conta. O login volta a pedir só a senha.',
      ],
      footnote:
        'Não foi você? Redefina a senha imediatamente e ative a verificação em duas etapas de novo.',
    }),
  };
}
