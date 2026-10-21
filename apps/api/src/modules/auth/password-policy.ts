import { normalizePassword } from '@kora/contracts';

/**
 * Senhas comuns que passam do tamanho mínimo. As mais comuns de todas são
 * curtas e já caem na regra de 12 caracteres. Num próximo passo dá para
 * consultar o Have I Been Pwned por k-anonymity.
 */
const COMMON_PASSWORDS = new Set([
  '123456789012',
  '1234567890123',
  '12345678910111213',
  '123123123123',
  '111111111111',
  '000000000000',
  'qwertyuiop12',
  'qwertyuiop123',
  'qwertyuiopasdfghjkl',
  '1q2w3e4r5t6y',
  '1qaz2wsx3edc',
  'password1234',
  'password12345',
  'passwordpassword',
  'senha1234567',
  'senhasenha123',
  'minhasenha123',
  'mudar@123456',
  'abcdefghijkl',
  'abc123abc123',
  'iloveyou1234',
  'aaaaaaaaaaaa',
  'administrator',
  'admin1234567',
  'brasil123456',
  'corinthians123',
  'flamengo1234',
  'palmeiras123',
]);

/** Regras que dependem do contexto do usuário. Devolve o motivo da recusa ou null. */
export function checkPasswordPolicy(
  password: string,
  context: { email: string; name: string },
): string | null {
  const normalized = normalizePassword(password).toLowerCase();
  if (COMMON_PASSWORDS.has(normalized) || /^(.)\1+$/.test(normalized)) {
    return 'Essa senha é muito comum. Escolha outra.';
  }
  const emailLocal = context.email.split('@')[0] ?? '';
  if (emailLocal.length >= 4 && normalized.includes(emailLocal)) {
    return 'A senha não pode conter o seu e-mail.';
  }
  if (normalized === context.name.toLowerCase().replace(/\s+/g, '')) {
    return 'A senha não pode ser o seu nome.';
  }
  return null;
}
