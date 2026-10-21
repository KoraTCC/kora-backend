import type { RegisterInput, UserResponse } from '@kora/contracts';
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
}
