import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Cifra simétrica para segredos que precisam ser lidos de volta (ex.: o
 * segredo TOTP), ao contrário de senhas e tokens, que guardamos só o hash.
 *
 * AES-256-GCM: confidencialidade + integridade (a tag detecta qualquer
 * alteração). Formato salvo: `v1.<iv>.<tag>.<cifrado>` em base64url, com IV
 * aleatório de 12 bytes por valor.
 */
const VERSION = 'v1';

export class SecretBox {
  private readonly key: Buffer;

  /** `hexKey`: 32 bytes em hex (64 caracteres), vindo de `DATA_ENCRYPTION_KEY`. */
  constructor(hexKey: string) {
    this.key = Buffer.from(hexKey, 'hex');
    if (this.key.length !== 32) {
      throw new Error(
        'DATA_ENCRYPTION_KEY precisa ter 32 bytes (64 caracteres hex).',
      );
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return [VERSION, iv, cipher.getAuthTag(), encrypted]
      .map((part) =>
        typeof part === 'string' ? part : part.toString('base64url'),
      )
      .join('.');
  }

  /** Lança erro se o valor foi adulterado ou cifrado com outra chave. */
  decrypt(sealed: string): string {
    const [version, iv, tag, encrypted] = sealed.split('.');
    if (version !== VERSION || !iv || !tag || !encrypted) {
      throw new Error('Formato de segredo cifrado inválido.');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
