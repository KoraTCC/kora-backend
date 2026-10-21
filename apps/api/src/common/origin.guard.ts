import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ENV, type Env } from '../config/env.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SKIP_ORIGIN_CHECK = 'skipOriginCheck';

/** Libera a rota da checagem de origem (ex.: webhooks servidor-a-servidor). */
export const SkipOriginCheck = () => SetMetadata(SKIP_ORIGIN_CHECK, true);

/**
 * Defesa contra CSRF em profundidade, somada ao SameSite dos cookies:
 * requisições que mudam estado vindas de navegador precisam ter Origin
 * na allowlist. Clientes fora do navegador não enviam Origin e não
 * carregam os cookies da vítima, então passam.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowed: Set<string>;

  constructor(
    @Inject(ENV) env: Env,
    private readonly reflector: Reflector,
  ) {
    this.allowed = new Set(env.FRONTEND_ORIGINS.map((o) => new URL(o).origin));
  }

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ORIGIN_CHECK, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;

    const origin = req.headers.origin;
    if (origin) {
      if (this.allowed.has(origin)) return true;
      throw new ForbiddenException('Origem não permitida');
    }

    if (req.headers['sec-fetch-site'] === 'cross-site') {
      throw new ForbiddenException('Origem não permitida');
    }
    return true;
  }
}
