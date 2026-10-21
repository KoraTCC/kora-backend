import { existsSync } from 'node:fs';
import { z } from 'zod';

const csv = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.url()).min(1));

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  DATABASE_URL: z.url(),
  // Origens do frontend autorizadas (CORS + OriginGuard), separadas por vírgula.
  FRONTEND_ORIGINS: csv,
  // Quantos proxies confiáveis existem na frente da API (1 = Nginx).
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  // Segredos: no mínimo 32 caracteres (gere com `openssl rand -hex 32`).
  JWT_ACCESS_SECRET: z.string().min(32),
  // Pepper das senhas: se for perdido, todas as senhas ficam inválidas.
  PASSWORD_PEPPER: z.string().min(32),

  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(7 * 24 * 3600),
  // Limite absoluto de uma sessão, mesmo renovando o refresh token.
  SESSION_MAX_AGE_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(30 * 24 * 3600),
  // Só desligue em desenvolvimento local sem HTTPS.
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});

export type Env = z.infer<typeof envSchema>;

export const ENV = Symbol('ENV');

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (source === process.env && existsSync('.env')) {
    process.loadEnvFile('.env');
  }

  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
  }
  return parsed.data;
}
