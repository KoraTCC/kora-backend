import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { User } from '../users/user.entity.js';
import { UsersService } from '../users/users.service.js';
import { AuthCookies } from './auth-cookies.service.js';
import { SessionService } from './session.service.js';

const INVALID_SESSION = 'Sessão expirada ou inválida.';

interface AuthenticatedRequest extends Request {
  user?: User;
}

/**
 * Exige um access token válido no cookie httpOnly e carrega o usuário.
 * Tokens emitidos antes da última troca de senha são recusados.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly cookies: AuthCookies,
    private readonly sessions: SessionService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token: unknown = req.cookies?.[this.cookies.accessName];
    if (typeof token !== 'string' || !token) {
      throw new UnauthorizedException(INVALID_SESSION);
    }

    const payload = await this.sessions.verifyAccessToken(token).catch(() => {
      throw new UnauthorizedException(INVALID_SESSION);
    });

    const user = await this.users.findById(payload.sub);
    // `iat` tem precisão de segundos: compara no mesmo grão.
    const changedAt = Math.floor(
      (user?.passwordChangedAt.getTime() ?? 0) / 1000,
    );
    if (!user || payload.iat < changedAt) {
      throw new UnauthorizedException(INVALID_SESSION);
    }

    req.user = user;
    return true;
  }
}

/** Usuário carregado pelo `AccessTokenGuard`. */
export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext): User => {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.user) throw new UnauthorizedException(INVALID_SESSION);
    return req.user;
  },
);
