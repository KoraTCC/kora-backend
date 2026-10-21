import { normalizePassword } from '@kora/contracts';
import { Inject, Injectable } from '@nestjs/common';
import {
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import { ENV, type Env } from '../../config/env.js';

interface ScryptParams {
  /** log2 de N (custo de CPU/memória). */
  ln: number;
  r: number;
  p: number;
}

/**
 * Parâmetros da OWASP (Password Storage Cheat Sheet) para scrypt:
 * N=2^15, r=8, p=3 usa ~32 MiB por hash. A tabela da OWASP tem opções
 * equivalentes com mais memória (N=2^17, r=8, p=1 usa 128 MiB); esta
 * cabe melhor numa VPS pequena com vários logins ao mesmo tempo.
 */
export const CURRENT_PARAMS: ScryptParams = { ln: 15, r: 8, p: 3 };

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const PREFIX = 'scrypt';

function scryptAsync(
  password: Buffer,
  salt: Buffer,
  { ln, r, p }: ScryptParams,
): Promise<Buffer> {
  const N = 2 ** ln;
  const options: ScryptOptions = { N, r, p, maxmem: 256 * N * r + 1024 * 1024 };
  // Versão assíncrona: roda no threadpool do libuv, sem travar o event loop.
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, options, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/**
 * Hash de senhas com scrypt + pepper.
 *
 * Formato salvo (autodescritivo, permite trocar parâmetros no futuro):
 *   scrypt$ln=15,r=8,p=3$<salt base64>$<hash base64>
 */
@Injectable()
export class PasswordHasher {
  private readonly pepper: string;

  constructor(@Inject(ENV) env: Pick<Env, 'PASSWORD_PEPPER'>) {
    this.pepper = env.PASSWORD_PEPPER;
  }

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const key = await scryptAsync(
      this.pepperize(password),
      salt,
      CURRENT_PARAMS,
    );
    const { ln, r, p } = CURRENT_PARAMS;
    return [
      PREFIX,
      `ln=${ln},r=${r},p=${p}`,
      salt.toString('base64'),
      key.toString('base64'),
    ].join('$');
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const parsed = parse(stored);
    if (!parsed) return false;
    const key = await scryptAsync(
      this.pepperize(password),
      parsed.salt,
      parsed.params,
    );
    return key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
  }

  /** true quando o hash foi gerado com parâmetros diferentes dos atuais. */
  needsRehash(stored: string): boolean {
    const parsed = parse(stored);
    if (!parsed) return true;
    const { ln, r, p } = parsed.params;
    return (
      ln !== CURRENT_PARAMS.ln ||
      r !== CURRENT_PARAMS.r ||
      p !== CURRENT_PARAMS.p
    );
  }

  /**
   * HMAC-SHA256 com um segredo que fica fora do banco. Quem vazar só o
   * banco não consegue testar senhas offline. Também normaliza Unicode
   * para a mesma senha digitada em teclados diferentes bater.
   */
  private pepperize(password: string): Buffer {
    return createHmac('sha256', this.pepper)
      .update(normalizePassword(password))
      .digest();
  }
}

function parse(
  stored: string,
): { params: ScryptParams; salt: Buffer; key: Buffer } | null {
  const [prefix, paramStr, salt, key] = stored.split('$');
  if (prefix !== PREFIX || !paramStr || !salt || !key) return null;
  const match = /^ln=(\d+),r=(\d+),p=(\d+)$/.exec(paramStr);
  if (!match) return null;
  return {
    params: { ln: Number(match[1]), r: Number(match[2]), p: Number(match[3]) },
    salt: Buffer.from(salt, 'base64'),
    key: Buffer.from(key, 'base64'),
  };
}
