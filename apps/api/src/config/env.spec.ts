import { loadEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  FRONTEND_ORIGINS: 'http://localhost:5173, https://app.example.com',
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

  it('falha no boot se faltar variável obrigatória', () => {
    expect(() => loadEnv({ FRONTEND_ORIGINS: base.FRONTEND_ORIGINS })).toThrow(
      /DATABASE_URL/,
    );
  });
});
