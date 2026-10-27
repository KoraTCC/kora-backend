import { loadEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  FRONTEND_ORIGINS: 'http://localhost:5173, https://app.example.com',
  JWT_ACCESS_SECRET: 'j'.repeat(32),
  PASSWORD_PEPPER: 'p'.repeat(32),
};

describe('loadEnv', () => {
  it('aplica defaults e separa as origens', () => {
    const env = loadEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.FRONTEND_ORIGINS).toEqual([
      'http://localhost:5173',
      'https://app.example.com',
    ]);
  });

  it('liga cookies Secure por padrão', () => {
    expect(loadEnv(base).COOKIE_SECURE).toBe(true);
    expect(loadEnv({ ...base, COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(
      false,
    );
  });

  it('recusa segredos curtos', () => {
    expect(() => loadEnv({ ...base, PASSWORD_PEPPER: 'curto' })).toThrow(
      /PASSWORD_PEPPER/,
    );
  });

  it('falha no boot se faltar variável obrigatória', () => {
    expect(() => loadEnv({ ...base, DATABASE_URL: undefined })).toThrow(
      /DATABASE_URL/,
    );
  });
});
