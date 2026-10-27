import { createHmac, randomBytes, scryptSync } from 'node:crypto';
import { PasswordHasher } from './password-hasher.service.js';

const PEPPER = 'p'.repeat(32);

/** Gera um hash no formato antigo (scrypt), como os das primeiras contas. */
function legacyScryptHash(password: string): string {
  const salt = randomBytes(16);
  const peppered = createHmac('sha256', PEPPER)
    .update(password.normalize('NFKC'))
    .digest();
  const key = scryptSync(peppered, salt, 64, {
    N: 2 ** 15,
    r: 8,
    p: 3,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$ln=15,r=8,p=3$${salt.toString('base64')}$${key.toString('base64')}`;
}

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher({ PASSWORD_PEPPER: PEPPER });
  const password = 'correct horse battery staple';

  it('verifica a senha correta e rejeita a errada', async () => {
    const stored = await hasher.hash(password);
    expect(await hasher.verify(password, stored)).toBe(true);
    expect(await hasher.verify('senha errada qualquer', stored)).toBe(false);
  });

  it('usa Argon2id no formato PHC padrão e nunca guarda a senha em claro', async () => {
    const stored = await hasher.hash(password);
    expect(stored).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/,
    );
    expect(stored).not.toContain(password);
  });

  it('gera salt diferente a cada hash', async () => {
    const [a, b] = await Promise.all([
      hasher.hash(password),
      hasher.hash(password),
    ]);
    expect(a).not.toBe(b);
  });

  it('depende do pepper: outro pepper não valida o mesmo hash', async () => {
    const stored = await hasher.hash(password);
    const other = new PasswordHasher({ PASSWORD_PEPPER: 'x'.repeat(32) });
    expect(await other.verify(password, stored)).toBe(false);
  });

  it('normaliza Unicode (NFC e NFD da mesma senha batem)', async () => {
    const nfc = 'senhaçãoválida123'.normalize('NFC');
    const nfd = nfc.normalize('NFD');
    expect(nfc).not.toBe(nfd);
    expect(await hasher.verify(nfd, await hasher.hash(nfc))).toBe(true);
  });

  it('o custo faz parte do hash: adulterar os parâmetros invalida', async () => {
    const stored = await hasher.hash(password);
    const tampered = stored.replace('t=2', 't=3');
    expect(await hasher.verify(password, tampered)).toBe(false);
  });

  it('pede rehash quando os parâmetros mudam ou o formato não é Argon2id', async () => {
    const stored = await hasher.hash(password);
    expect(hasher.needsRehash(stored)).toBe(false);
    expect(hasher.needsRehash(stored.replace('m=19456', 'm=12288'))).toBe(true);
    expect(hasher.needsRehash('$2b$10$bcrypt-antigo')).toBe(true);
  });

  it('rejeita hash malformado ou de outro algoritmo sem lançar erro', async () => {
    expect(await hasher.verify(password, 'lixo')).toBe(false);
    expect(await hasher.verify(password, '$2b$10$bcrypt-antigo')).toBe(false);
    expect(
      await hasher.verify(password, '$argon2i$v=19$m=19456,t=2,p=1$YQ$YQ'),
    ).toBe(false);
  });

  describe('legado scrypt', () => {
    it('ainda aceita as contas criadas com scrypt', async () => {
      const legacy = legacyScryptHash(password);
      expect(await hasher.verify(password, legacy)).toBe(true);
      expect(await hasher.verify('senha errada qualquer', legacy)).toBe(false);
    });

    it('pede rehash para migrar o hash para Argon2id', () => {
      expect(hasher.needsRehash(legacyScryptHash(password))).toBe(true);
    });
  });
});
