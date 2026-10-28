import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ENV, type Env } from '../../config/env.js';
import { AuditModule } from '../audit/audit.module.js';
import { UsersModule } from '../users/users.module.js';
import { AccessTokenGuard } from './access-token.guard.js';
import { AuthCookies } from './auth-cookies.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordHasher } from './password-hasher.service.js';
import { RefreshToken } from './refresh-token.entity.js';
import { SessionService } from './session.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([RefreshToken]),
    JwtModule.registerAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        secret: env.JWT_ACCESS_SECRET,
        signOptions: { algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
    UsersModule,
    AuditModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthCookies,
    PasswordHasher,
    SessionService,
    AccessTokenGuard,
  ],
  // Outros módulos protegem rotas com @UseGuards(AccessTokenGuard); o guard
  // é instanciado no módulo de quem usa, então as dependências vão junto.
  exports: [AccessTokenGuard, AuthCookies, SessionService, UsersModule],
})
export class AuthModule {}
