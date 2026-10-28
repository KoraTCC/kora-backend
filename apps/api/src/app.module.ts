import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { OriginGuard } from './common/origin.guard.js';
import { ConfigModule } from './config/config.module.js';
import { ENV, type Env } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { ChargesModule } from './modules/charges/charges.module.js';
import { MerchantsModule } from './modules/merchants/merchants.module.js';
import { WalletsModule } from './modules/wallets/wallets.module.js';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          autoLogging: { ignore: (req) => req.url === '/health' },
          serializers: {
            res: (res: { statusCode: number }) => ({
              statusCode: res.statusCode,
            }),
          },
          // Nunca registrar credenciais, tokens ou cookies.
          redact: {
            paths: [
              'req.headers.cookie',
              'req.headers.authorization',
              'res.headers["set-cookie"]',
              '*.password',
              '*.newPassword',
              '*.token',
            ],
            censor: '[redacted]',
          },
          transport:
            env.NODE_ENV === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),
    // Limite global por IP; rotas sensíveis ganham limites próprios.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    DatabaseModule,
    AuthModule,
    MerchantsModule,
    WalletsModule,
    ChargesModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: OriginGuard },
  ],
})
export class AppModule {}
