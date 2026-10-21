import { PasswordHasher } from './password-hasher.service.js';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher({ PASSWORD_PEPPER: 'p'.repeat(32) });
  const password = 'correct horse battery staple';

  it('verifica a senha correta e rejeita a errada', async () => {
    const stored = await hasher.hash(password);
    expect(await hasher.verify(password, stored)).toBe(true);
    expect(await hasher.verify('senha errada qualquer', stored)).toBe(false);
  });

  it('usa formato autodescritivo e nunca guarda a senha em claro', async () => {
    const stored = await hasher.hash(password);
    expect(stored).toMatch(
      /^scrypt\$ln=15,r=8,p=3\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/,
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

  it('pede rehash quando os parâmetros mudam ou o formato é inválido', async () => {
    const stored = await hasher.hash(password);
    expect(hasher.needsRehash(stored)).toBe(false);
    expect(hasher.needsRehash(stored.replace('ln=15', 'ln=14'))).toBe(true);
    expect(hasher.needsRehash('$2b$10$bcrypt-antigo')).toBe(true);
  });

  it('o custo faz parte do hash: adulterar os parâmetros invalida', async () => {
    const stored = await hasher.hash(password);
    const tampered = stored.replace('ln=15', 'ln=14');
    // Mesmo salt, custo diferente: hash diferente, então não valida.
    expect(await hasher.verify(password, tampered)).toBe(false);
  });

  it('rejeita hash malformado sem lançar erro', async () => {
    expect(await hasher.verify(password, 'lixo')).toBe(false);
  });
});
