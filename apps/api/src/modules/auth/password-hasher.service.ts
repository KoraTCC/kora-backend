import { Inject, Injectable } from '@nestjs/common';
import {
  argon2,
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
  type Argon2Parameters,
} from 'node:crypto';
import { ENV, type Env } from '../../config/env.js';

interface Argon2Params {
  /** Memória em KiB. */
  m: number;
  /** Iterações (passes). */
  t: number;
  /** Paralelismo (lanes). */
  p: number;
}

/**
 * Argon2id com a configuração mínima da OWASP (Password Storage Cheat
 * Sheet): 19 MiB de memória, 2 iterações, paralelismo 1. Cerca de 80 ms
 * por hash; cabe numa VPS de 1 vCPU com vários logins simultâneos.
 */
export const CURRENT_PARAMS: Argon2Params = { m: 19_456, t: 2, p: 1 };

const ARGON2_VERSION = 19; // 0x13, versão atual do algoritmo
const TAG_LENGTH = 32;
const SALT_LENGTH = 16;

function argon2idAsync(
  password: string,
  salt: Buffer,
  secret: Buffer,
  { m, t, p }: Argon2Params,
  tagLength: number,
): Promise<Buffer> {
  const params: Argon2Parameters = {
    message: password,
    nonce: salt,
    secret,
    memory: m,
    passes: t,
    parallelism: p,
    tagLength,
  };
  // Versão assíncrona: roda no threadpool do libuv, sem travar o event loop.
  return new Promise((resolve, reject) => {
    argon2('argon2id', params, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/**
 * Hash de senhas com Argon2id + pepper.
 *
 * Formato salvo: string PHC padrão, a mesma usada por outras bibliotecas
 * de Argon2 (o salt e o hash vão em base64 sem padding):
 *   $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>
 *
 * O pepper vai no parâmetro `secret` do próprio Argon2 (RFC 9106, seção
 * 3.1), e não dentro da string: quem vazar só o banco não consegue testar
 * senhas offline.
 */
@Injectable()
export class PasswordHasher {
  private readonly pepper: Buffer;

  constructor(@Inject(ENV) env: Pick<Env, 'PASSWORD_PEPPER'>) {
    this.pepper = Buffer.from(env.PASSWORD_PEPPER, 'utf8');
  }

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const key = await argon2idAsync(
      normalize(password),
      salt,
      this.pepper,
      CURRENT_PARAMS,
      TAG_LENGTH,
    );
    const { m, t, p } = CURRENT_PARAMS;
    return `$argon2id$v=${ARGON2_VERSION}$m=${m},t=${t},p=${p}$${b64(salt)}$${b64(key)}`;
  }

  async verify(password: string, stored: string): Promise<boolean> {
    if (stored.startsWith(LEGACY_SCRYPT_PREFIX)) {
      return verifyLegacyScrypt(normalize(password), stored, this.pepper);
    }
    const parsed = parseArgon2(stored);
    if (!parsed) return false;
    const key = await argon2idAsync(
      normalize(password),
      parsed.salt,
      this.pepper,
      parsed.params,
      parsed.key.length,
    );
    return timingSafeEqual(key, parsed.key);
  }

  /** true quando o hash não é Argon2id com os parâmetros atuais. */
  needsRehash(stored: string): boolean {
    const parsed = parseArgon2(stored);
    if (!parsed) return true;
    const { m, t, p } = parsed.params;
    return (
      m !== CURRENT_PARAMS.m || t !== CURRENT_PARAMS.t || p !== CURRENT_PARAMS.p
    );
  }
}

/** A mesma senha digitada em teclados/SOs diferentes gera o mesmo hash. */
function normalize(password: string): string {
  return password.normalize('NFKC');
}

function b64(buffer: Buffer): string {
  return buffer.toString('base64').replace(/=+$/, '');
}

function parseArgon2(
  stored: string,
): { params: Argon2Params; salt: Buffer; key: Buffer } | null {
  const match =
    /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(
      stored,
    );
  if (!match || Number(match[1]) !== ARGON2_VERSION) return null;
  const key = Buffer.from(match[6]!, 'base64');
  if (key.length < 16) return null;
  return {
    params: { m: Number(match[2]), t: Number(match[3]), p: Number(match[4]) },
    salt: Buffer.from(match[5]!, 'base64'),
    key,
  };
}

/*
 * Legado: as primeiras contas foram criadas com scrypt + pepper HMAC
 * (`scrypt$ln=15,r=8,p=3$salt$hash`). Esses hashes ainda são aceitos no
 * login e `needsRehash` devolve true para eles, então o próprio login
 * regrava a senha em Argon2id. Pode ser removido quando não houver mais
 * nenhum `scrypt$` em `users.password_hash`.
 */
const LEGACY_SCRYPT_PREFIX = 'scrypt$';

function verifyLegacyScrypt(
  password: string,
  stored: string,
  pepper: Buffer,
): Promise<boolean> {
  const match = /^scrypt\$ln=(\d+),r=(\d+),p=(\d+)\$([^$]+)\$([^$]+)$/.exec(
    stored,
  );
  if (!match) return Promise.resolve(false);
  const N = 2 ** Number(match[1]);
  const r = Number(match[2]);
  const p = Number(match[3]);
  const salt = Buffer.from(match[4]!, 'base64');
  const expected = Buffer.from(match[5]!, 'base64');
  if (expected.length < 16) return Promise.resolve(false);
  const peppered = createHmac('sha256', pepper).update(password).digest();
  return new Promise((resolve, reject) => {
    scrypt(
      peppered,
      salt,
      expected.length,
      { N, r, p, maxmem: 256 * N * r + 1024 * 1024 },
      (err, key) =>
        err ? reject(err) : resolve(timingSafeEqual(key, expected)),
    );
  });
}
