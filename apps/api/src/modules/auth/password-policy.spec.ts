import { checkPasswordPolicy } from './password-policy.js';

const ctx = { email: 'maria.silva@example.com', name: 'Maria Silva' };

describe('checkPasswordPolicy', () => {
  it('aceita uma senha longa e única', () => {
    expect(
      checkPasswordPolicy('cavalo bateria grampo correto', ctx),
    ).toBeNull();
  });

  it.each(['Password1234', '123456789012', 'zzzzzzzzzzzzzz'])(
    'recusa senha comum ou repetitiva: %s',
    (password) => {
      expect(checkPasswordPolicy(password, ctx)).toMatch(/comum/);
    },
  );

  it('recusa senha que contém o e-mail', () => {
    expect(checkPasswordPolicy('maria.silva2024!', ctx)).toMatch(/e-mail/);
  });

  it('recusa senha igual ao nome', () => {
    expect(
      checkPasswordPolicy('mariasilva', { ...ctx, name: 'Maria Silva' }),
    ).toMatch(/nome/);
  });
});
