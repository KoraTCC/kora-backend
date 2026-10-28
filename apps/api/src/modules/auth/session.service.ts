import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  DataSource,
  IsNull,
  type EntityManager,
  type Repository,
} from 'typeorm';
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

export interface RevokedSession {
  userId: string;
  familyId: string;
}

/**
 * Janela em que reapresentar um refresh recém-rotacionado é tratado como
 * corrida legítima (duas abas renovando juntas), e não como roubo.
 */
export const REFRESH_REUSE_GRACE_MS = 10_000;

export type RotateResult =
  | { status: 'rotated'; userId: string; tokens: SessionTokens }
  | { status: 'reused'; userId: string; familyId: string }
  /** Rotacionado há pouco por outra requisição (corrida legítima). */
  | { status: 'superseded' }
  | { status: 'invalid' };

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
    private readonly dataSource: DataSource,
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
    const { token } = await this.storeRefreshToken(
      { userId, familyId, sessionExpiresAt, meta },
      manager,
    );
    return {
      accessToken: await this.signAccessToken({ sub: userId, sid: familyId }),
      refreshToken: token,
    };
  }

  /**
   * Troca um refresh token por um par novo (rotação). O token usado é
   * revogado e aponta para o sucessor. Reapresentar um token já rotacionado
   * fora da janela de tolerância indica roubo: a família inteira cai.
   */
  rotate(refreshToken: string, meta: RequestMeta): Promise<RotateResult> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(RefreshToken);
      // O lock serializa renovações simultâneas do mesmo token.
      const current = await repo.findOne({
        where: { tokenHash: hashToken(refreshToken) },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current) return { status: 'invalid' };

      const now = new Date();
      if (current.revokedAt) {
        return this.handleRevoked(current, now, manager);
      }
      if (current.expiresAt <= now || current.sessionExpiresAt <= now) {
        return { status: 'invalid' };
      }

      const next = await this.storeRefreshToken(
        {
          userId: current.userId,
          familyId: current.familyId,
          sessionExpiresAt: current.sessionExpiresAt,
          meta,
        },
        manager,
      );
      await repo.update(current.id, { revokedAt: now, replacedById: next.id });

      return {
        status: 'rotated',
        userId: current.userId,
        tokens: {
          accessToken: await this.signAccessToken({
            sub: current.userId,
            sid: current.familyId,
          }),
          refreshToken: next.token,
        },
      };
    });
  }

  /** Revoga todas as sessões do usuário (ex.: depois de redefinir a senha). */
  async revokeAllForUser(
    userId: string,
    manager: EntityManager,
  ): Promise<void> {
    await manager
      .getRepository(RefreshToken)
      .update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  /** Revoga todos os refresh tokens ativos da família informada. */
  revokeFamily(refreshToken: string): Promise<RevokedSession | null> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(RefreshToken);
      const current = await repo.findOne({
        where: { tokenHash: hashToken(refreshToken) },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current || current.revokedAt) return null;

      await repo.update(
        { familyId: current.familyId, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
      return { userId: current.userId, familyId: current.familyId };
    });
  }

  private async handleRevoked(
    token: RefreshToken,
    now: Date,
    manager: EntityManager,
  ): Promise<RotateResult> {
    const rotatedRecently =
      token.replacedById !== null &&
      now.getTime() - token.revokedAt!.getTime() < REFRESH_REUSE_GRACE_MS;
    // Revogado sem sucessor (ex.: logout): só recusa.
    if (!token.replacedById) return { status: 'invalid' };
    if (rotatedRecently) return { status: 'superseded' };

    await manager
      .getRepository(RefreshToken)
      .update(
        { familyId: token.familyId, revokedAt: IsNull() },
        { revokedAt: now },
      );
    return { status: 'reused', userId: token.userId, familyId: token.familyId };
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
  ): Promise<{ id: string; token: string }> {
    const repo = manager?.getRepository(RefreshToken) ?? this.refreshTokens;
    const token = randomBytes(32).toString('base64url');
    const ttlExpiry = Date.now() + this.env.REFRESH_TOKEN_TTL_SECONDS * 1000;
    const result = await repo.insert({
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
    return { id: (result.identifiers[0] as { id: string }).id, token };
  }
}
