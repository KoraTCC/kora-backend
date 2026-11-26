import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238), o código de 6 dígitos dos apps autenticadores (Google
 * Authenticator, Authy, 1Password…). Implementado com `node:crypto`:
 * HMAC-SHA1 sobre o número do período de 30 s (RFC 4226, HOTP).
 */

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Períodos aceitos antes/depois do atual: relógio do celular fora de hora. */
const DRIFT_STEPS = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Base32 inválido');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Segredo novo: 20 bytes (160 bits, o tamanho recomendado pela RFC 4226). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function currentStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

/** Código de um período (HOTP com contador = período). */
export function totpAt(
  secretBase32: string,
  step: number,
  digits = TOTP_DIGITS,
): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secretBase32))
    .update(counter)
    .digest();
  // Truncamento dinâmico (RFC 4226, seção 5.3).
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * Confere o código contra o período atual e os vizinhos. Devolve o período
 * que bateu (para o anti-replay) ou null. `afterStep`: só aceita períodos
 * posteriores ao último já usado, então um código não vale duas vezes.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  options: { nowMs?: number; afterStep?: number | null } = {},
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = currentStep(options.nowMs);
  for (let step = now - DRIFT_STEPS; step <= now + DRIFT_STEPS; step++) {
    if (options.afterStep != null && step <= options.afterStep) continue;
    const expected = Buffer.from(totpAt(secretBase32, step));
    if (timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
}

/** URI que o QR code carrega; os apps autenticadores leem esse formato. */
export function otpauthUri(secretBase32: string, account: string): string {
  const label = encodeURIComponent(`Kora:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer: 'Kora',
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
