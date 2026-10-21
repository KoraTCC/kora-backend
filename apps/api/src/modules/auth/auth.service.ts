import type { LoginInput, RegisterInput, UserResponse } from '@kora/contracts';
import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { RequestMeta } from '../../common/request-meta.js';
import { AuditEvent } from '../audit/audit-log.entity.js';
import { AuditService } from '../audit/audit.service.js';
import { toUserResponse } from '../users/user.mapper.js';
import { UsersService } from '../users/users.service.js';
import { PasswordHasher } from './password-hasher.service.js';
import { checkPasswordPolicy } from './password-policy.js';
import { SessionService, type SessionTokens } from './session.service.js';

const INVALID_SESSION = 'Sessão expirada ou inválida.';

/**
 * Outra requisição acabou de renovar esta sessão. Os cookies novos já foram
 * enviados por ela, então quem recebe este erro não deve apagá-los.
 */
export class SupersededRefreshError extends UnauthorizedException {
  constructor() {
    super(INVALID_SESSION);
  }
}

/** Falhas seguidas que travam a conta, e por quanto tempo. */
export const MAX_FAILED_LOGINS = 5;
export const LOCK_DURATION_MS = 15 * 60 * 1000;

/** Mesma resposta para e-mail inexistente, senha errada e conta travada. */
const INVALID_CREDENTIALS = 'E-mail ou senha incorretos.';

export interface AuthResult {
  user: UserResponse;
  tokens: SessionTokens;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly users: UsersService,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  private dummyHash?: Promise<string>;

  async register(input: RegisterInput, meta: RequestMeta): Promise<AuthResult> {
    const policyError = checkPasswordPolicy(input.password, input);
    if (policyError) {
      throw new BadRequestException({
        message: 'Dados inválidos',
        issues: [{ path: 'password', message: policyError }],
      });
    }

    const passwordHash = await this.hasher.hash(input.password);

    // Usuário, sessão e auditoria são gravados juntos ou nada é gravado.
    return this.dataSource.transaction(async (manager) => {
      const user = await this.users.create(
        { name: input.name, email: input.email, passwordHash },
        manager,
      );
      const tokens = await this.sessions.start(user.id, meta, manager);
      await this.audit.record(AuditEvent.Register, meta, user.id, {}, manager);
      return { user: toUserResponse(user), tokens };
    });
  }

  async refresh(refreshToken: string, meta: RequestMeta): Promise<AuthResult> {
    if (!refreshToken) throw new UnauthorizedException(INVALID_SESSION);

    const result = await this.sessions.rotate(refreshToken, meta);
    if (result.status === 'reused') {
      await this.audit.record(AuditEvent.RefreshReuse, meta, result.userId, {
        familyId: result.familyId,
      });
    }
    if (result.status === 'superseded') throw new SupersededRefreshError();
    if (result.status !== 'rotated') {
      throw new UnauthorizedException(INVALID_SESSION);
    }

    const user = await this.users.findById(result.userId);
    if (!user) throw new UnauthorizedException(INVALID_SESSION);
    return { user: toUserResponse(user), tokens: result.tokens };
  }

  async logout(refreshToken: string, meta: RequestMeta): Promise<void> {
    if (!refreshToken) return;

    const revoked = await this.sessions.revokeFamily(refreshToken);
    if (!revoked) return;

    await this.audit.record(AuditEvent.Logout, meta, revoked.userId, {
      familyId: revoked.familyId,
    });
  }

  async login(input: LoginInput, meta: RequestMeta): Promise<AuthResult> {
    const user = await this.users.findByEmail(input.email);

    if (!user) {
      // Gasta o mesmo tempo de um scrypt real: o tempo de resposta não
      // revela se o e-mail tem conta.
      await this.hasher.verify(input.password, await this.getDummyHash());
      await this.audit.record(AuditEvent.LoginFailure, meta, null, {
        reason: 'unknown_email',
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      await this.audit.record(AuditEvent.LoginFailure, meta, user.id, {
        reason: 'locked',
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const isValid = await this.hasher.verify(input.password, user.passwordHash);
    if (!isValid) {
      await this.handleFailedLogin(user.id, meta);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const newHash = this.hasher.needsRehash(user.passwordHash)
      ? await this.hasher.hash(input.password)
      : undefined;

    return this.dataSource.transaction(async (manager) => {
      await this.users.recordSuccessfulLogin(user.id, newHash, manager);
      const tokens = await this.sessions.start(user.id, meta, manager);
      await this.audit.record(
        AuditEvent.LoginSuccess,
        meta,
        user.id,
        {},
        manager,
      );
      return { user: toUserResponse(user), tokens };
    });
  }

  private async handleFailedLogin(
    userId: string,
    meta: RequestMeta,
  ): Promise<void> {
    const locked = await this.users.recordFailedLogin(
      userId,
      MAX_FAILED_LOGINS,
      new Date(Date.now() + LOCK_DURATION_MS),
    );
    await this.audit.record(AuditEvent.LoginFailure, meta, userId, {
      reason: 'wrong_password',
    });
    if (locked) {
      await this.audit.record(AuditEvent.AccountLocked, meta, userId);
    }
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hasher.hash('kora-dummy-password-timing');
    return this.dummyHash;
  }
}
