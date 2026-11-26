import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  otpauthUri,
  totpAt,
  verifyTotp,
} from './totp.js';

// RFC 6238, apêndice B: segredo ASCII "12345678901234567890" (SHA-1).
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('totp', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('vetor da RFC 6238 em T=%i', (seconds, expected) => {
    expect(totpAt(RFC_SECRET, Math.floor(seconds / 30), 8)).toBe(expected);
  });

  it('6 dígitos = últimos 6 do valor da RFC', () => {
    expect(totpAt(RFC_SECRET, Math.floor(59 / 30))).toBe('287082');
  });

  it('base32 ida e volta', () => {
    const bytes = Buffer.from('qualquer coisa com 20b');
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  });

  it('gera segredos de 160 bits em base32', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(generateTotpSecret()).not.toBe(secret);
  });

  it('aceita o período atual e os vizinhos (relógio fora de hora)', () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(secret, totpAt(secret, step), { nowMs: now })).toBe(step);
    expect(verifyTotp(secret, totpAt(secret, step - 1), { nowMs: now })).toBe(
      step - 1,
    );
    expect(verifyTotp(secret, totpAt(secret, step + 1), { nowMs: now })).toBe(
      step + 1,
    );
    expect(
      verifyTotp(secret, totpAt(secret, step - 3), { nowMs: now }),
    ).toBeNull();
  });

  it('anti-replay: não aceita período já usado', () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    const code = totpAt(secret, step);
    expect(
      verifyTotp(secret, code, { nowMs: now, afterStep: step }),
    ).toBeNull();
    expect(verifyTotp(secret, code, { nowMs: now, afterStep: step - 1 })).toBe(
      step,
    );
  });

  it('recusa formato inválido', () => {
    expect(verifyTotp(RFC_SECRET, '12345')).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef')).toBeNull();
  });

  it('monta a URI do QR code', () => {
    const uri = otpauthUri('JBSWY3DPEHPK3PXP', 'ana@example.com');
    expect(uri).toBe(
      'otpauth://totp/Kora%3Aana%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Kora&algorithm=SHA1&digits=6&period=30',
    );
  });
});
