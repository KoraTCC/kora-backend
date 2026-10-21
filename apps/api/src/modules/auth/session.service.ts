import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { EntityManager, Repository } from 'typeorm';
import type { RequestMeta } from '../../common/request-meta.js';
import { ENV, type Env } from '../../config/env.js';
import { RefreshToken } from './refresh-token.entity.js';

export const JWT_ISSUER = 'kora-api';
export const JWT_AUDIENCE = 'kora-web';

export interface AccessTokenPayload {
  sub: string;
  /** Id da sessão (família de refresh tokens). */
  sid: string;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Emite as sessões. O access token é um JWT curto e stateless. O refresh
 * token é um valor aleatório opaco, do qual só o SHA-256 vai para o banco.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly jwt: JwtService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
  ) {}

  /** Cria uma sessão nova (nova família de refresh tokens). */
  async start(
    userId: string,
    meta: RequestMeta,
    manager?: EntityManager,
  ): Promise<SessionTokens> {
    const now = Date.now();
    const familyId = randomUUID();
    const sessionExpiresAt = new Date(
      now + this.env.SESSION_MAX_AGE_SECONDS * 1000,
    );
    const refreshToken = await this.storeRefreshToken(
      { userId, familyId, sessionExpiresAt, meta },
      manager,
    );
    return {
      accessToken: await this.signAccessToken({ sub: userId, sid: familyId }),
      refreshToken,
    };
  }

  /** Valida assinatura, algoritmo, validade, emissor e audiência. */
  verifyAccessToken(
    token: string,
  ): Promise<AccessTokenPayload & { iat: number }> {
    return this.jwt.verifyAsync(token, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: ['HS256'],
    });
  }

  signAccessToken(payload: AccessTokenPayload): Promise<string> {
    return this.jwt.signAsync(payload, {
      expiresIn: this.env.ACCESS_TOKEN_TTL_SECONDS,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithm: 'HS256',
    });
  }

  private async storeRefreshToken(
    params: {
      userId: string;
      familyId: string;
      sessionExpiresAt: Date;
      meta: RequestMeta;
    },
    manager?: EntityManager,
  ): Promise<string> {
    const repo = manager?.getRepository(RefreshToken) ?? this.refreshTokens;
    const token = randomBytes(32).toString('base64url');
    const ttlExpiry = Date.now() + this.env.REFRESH_TOKEN_TTL_SECONDS * 1000;
    await repo.insert({
      userId: params.userId,
      familyId: params.familyId,
      tokenHash: hashToken(token),
      // O refresh nunca passa do fim absoluto da sessão.
      expiresAt: new Date(
        Math.min(ttlExpiry, params.sessionExpiresAt.getTime()),
      ),
      sessionExpiresAt: params.sessionExpiresAt,
      ip: params.meta.ip,
      userAgent: params.meta.userAgent,
    });
    return token;
  }
}
