import {
  passwordChangedEmail,
  passwordResetEmail,
} from './password-reset.emails.js';

const LINK = 'https://app.korapag.com/reset-password?token=abc_DEF-123';

describe('e-mails de senha', () => {
  it('reset: botão e link em texto apontam para o token', () => {
    const mail = passwordResetEmail('ana@example.com', 'Ana', LINK);
    expect(mail.to).toBe('ana@example.com');
    expect(mail.html).toContain(`href="${LINK}"`);
    expect(mail.html).toContain('Criar nova senha');
    expect(mail.text).toContain(LINK);
    expect(mail.html).toMatch(/^<!DOCTYPE html>/);
  });

  it('escapa o nome do usuário (sem HTML injetado no e-mail)', () => {
    const mail = passwordResetEmail(
      'x@example.com',
      '<script>alert(1)</script>',
      LINK,
    );
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&#60;script&#62;');
  });

  it('tem texto de prévia e só estilos inline', () => {
    const mail = passwordResetEmail('ana@example.com', 'Ana', LINK);
    expect(mail.html).toContain('30 minutos');
    expect(mail.html).not.toMatch(/<link|<style/);
  });

  it('senha alterada: aponta para refazer a senha', () => {
    const mail = passwordChangedEmail(
      'ana@example.com',
      'Ana',
      'https://app.korapag.com/forgot-password',
    );
    expect(mail.subject).toMatch(/alterada/);
    expect(mail.html).toContain('https://app.korapag.com/forgot-password');
    expect(mail.text).toContain('https://app.korapag.com/forgot-password');
  });
});
