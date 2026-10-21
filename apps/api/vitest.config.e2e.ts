import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Os testes e2e compartilham o mesmo banco: rodar um arquivo por vez.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgres://kora:kora@localhost:5432/kora_test',
      FRONTEND_ORIGINS: 'http://localhost:5173',
    },
  },
});
