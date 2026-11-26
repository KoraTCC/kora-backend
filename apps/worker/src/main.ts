import 'reflect-metadata';
import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadEnv } from './config/env.js';

/** Níveis do pino (como na API) para os do logger do Nest. */
const LEVELS: Record<string, LogLevel[]> = {
  fatal: ['fatal'],
  error: ['fatal', 'error'],
  warn: ['fatal', 'error', 'warn'],
  info: ['fatal', 'error', 'warn', 'log'],
  debug: ['fatal', 'error', 'warn', 'log', 'debug'],
  trace: ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'],
};

async function bootstrap() {
  const env = loadEnv();
  // Sem HTTP: só o contêiner de injeção de dependências e os módulos.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: new ConsoleLogger({
      json: env.NODE_ENV === 'production',
      logLevels: LEVELS[env.LOG_LEVEL],
    }),
  });
  // SIGTERM do Docker: termina o lote atual e fecha o banco antes de sair.
  app.enableShutdownHooks();
}
await bootstrap();
