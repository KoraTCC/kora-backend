import type { ForgotPasswordInput, ResetPasswordInput } from '@kora/contracts';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import { DataSource, IsNull, type Repository } from 'typeorm';
import type { RequestMeta } from '../../common/request-meta.js';
import { ENV, type Env } from '../../config/env.js';
import { AuditEvent } from '../audit/audit-log.entity.js';
import { AuditService } from '../audit/audit.service.js';
import { MailService } from '../mail/mail.service.js';
import { UsersService } from '../users/users.service.js';
import { PasswordHasher } from './password-hasher.service.js';
import { checkPasswordPolicy } from './password-policy.js';
import { PasswordResetToken } from './password-reset-token.entity.js';
import { hashToken, SessionService } from './session.service.js';
import {
  passwordChangedEmail,
  passwordResetEmail,
} from './password-reset.emails.js';

export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const INVALID_LINK = 'Link inválido ou expirado. Peça um novo.';

@Injectable()
export class PasswordResetService {
  private readonly appUrl: string;

  constructor(
    @Inject(ENV) env: Env,
    @InjectRepository(PasswordResetToken)
    private readonly tokens: Repository<PasswordResetToken>,
    private readonly dataSource: DataSource,
    private readonly users: UsersService,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {
    this.appUrl = (env.APP_URL ?? env.FRONTEND_ORIGINS[0]!).replace(/\/$/, '');
  }

  /**
   * Sempre "dá certo" para quem chama: e-mail inexistente recebe a mesma
   * resposta, e o envio roda em segundo plano para o tempo de resposta não
   * revelar se a conta existe.
   */
  async request(input: ForgotPasswordInput, meta: RequestMeta): Promise<void> {
    const user = await this.users.findByEmail(input.email);
    if (!user) return;

    const token = randomBytes(32).toString('base64url');
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(PasswordResetToken);
      // Só o link mais recente vale: os anteriores são invalidados.
      await repo.update(
        { userId: user.id, usedAt: IsNull() },
        { usedAt: new Date() },
      );
      await repo.insert({
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      });
      await this.audit.record(
        AuditEvent.PasswordResetRequested,
        meta,
        user.id,
        {},
        manager,
      );
    });

    const link = `${this.appUrl}/reset-password?token=${token}`;
    this.mail.sendInBackground(passwordResetEmail(user.email, user.name, link));
  }

  async reset(input: ResetPasswordInput, meta: RequestMeta): Promise<void> {
    const tokenHash = hashToken(input.token);
    const pending = await this.tokens.findOneBy({ tokenHash });
    const user = pending ? await this.users.findById(pending.userId) : null;
    if (!pending || !user) throw new BadRequestException(INVALID_LINK);

    const policyError = checkPasswordPolicy(input.password, user);
    if (policyError) {
      throw new BadRequestException({
        message: 'Dados inválidos',
        issues: [{ path: 'password', message: policyError }],
      });
    }
    // Hash fora da transação: não segurar conexão do banco durante o Argon2.
    const passwordHash = await this.hasher.hash(input.password);

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(PasswordResetToken);
      // Lock + revalidação: dois envios do mesmo link não usam o token duas vezes.
      const token = await repo.findOne({
        where: { tokenHash },
        lock: { mode: 'pessimistic_write' },
      });
      if (!token || token.usedAt || token.expiresAt <= new Date()) {
        throw new BadRequestException(INVALID_LINK);
      }
      await repo.update(token.id, { usedAt: new Date() });
      await this.users.changePassword(user.id, passwordHash, manager);
      // Quem estava logado (inclusive um invasor) precisa entrar de novo.
      await this.sessions.revokeAllForUser(user.id, manager);
      await this.audit.record(
        AuditEvent.PasswordResetCompleted,
        meta,
        user.id,
        {},
        manager,
      );
    });

    this.mail.sendInBackground(
      passwordChangedEmail(
        user.email,
        user.name,
        `${this.appUrl}/forgot-password`,
      ),
    );
  }
}
