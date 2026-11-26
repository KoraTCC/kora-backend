import { SecretBox } from './secret-box.js';

const KEY = 'a'.repeat(64);

describe('SecretBox', () => {
  const box = new SecretBox(KEY);

  it('cifra e decifra', () => {
    const sealed = box.encrypt('JBSWY3DPEHPK3PXP');
    expect(sealed).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(box.decrypt(sealed)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('usa IV novo a cada vez (mesmo texto, cifras diferentes)', () => {
    expect(box.encrypt('igual')).not.toBe(box.encrypt('igual'));
  });

  it('rejeita valor adulterado', () => {
    const [v, iv, tag, data] = box.encrypt('segredo').split('.');
    const flipped = Buffer.from(data!, 'base64url');
    flipped[0]! ^= 1;
    expect(() =>
      box.decrypt([v, iv, tag, flipped.toString('base64url')].join('.')),
    ).toThrow();
  });

  it('rejeita chave errada', () => {
    const sealed = box.encrypt('segredo');
    expect(() => new SecretBox('b'.repeat(64)).decrypt(sealed)).toThrow();
  });

  it('exige chave de 32 bytes', () => {
    expect(() => new SecretBox('abc')).toThrow(/32 bytes/);
  });
});
