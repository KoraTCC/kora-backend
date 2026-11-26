import {
  RECOVERY_CODES_COUNT,
  type TwoFactorSetupResponse,
  type TwoFactorStatusResponse,
} from '@kora/contracts';
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomInt } from 'node:crypto';
import { DataSource, IsNull, type EntityManager } from 'typeorm';
import type { RequestMeta } from '../../common/request-meta.js';
import { SecretBox } from '../../common/secret-box.js';
import { AuditService } from '../audit/audit.service.js';
import { MailService } from '../mail/mail.service.js';
import { TWO_FACTOR_CHALLENGE_TTL_SECONDS } from './auth-cookies.service.js';
import { PasswordHasher } from './password-hasher.service.js';
import { hashToken, JWT_ISSUER } from './session.service.js';
import {
  twoFactorDisabledEmail,
  twoFactorEnabledEmail,
} from './two-factor.emails.js';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp.js';
import { AuditEvent, RecoveryCode, User } from '@kora/database';

/** Audiência própria: um desafio de 2FA nunca serve como access token. */
const CHALLENGE_AUDIENCE = 'kora-2fa';
/** Sem i, l, o, 0 e 1, que se confundem ao copiar à mão. */
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export type TwoFactorMethod = 'totp' | 'recovery';

function invalidField(path: string, message: string): BadRequestException {
  return new BadRequestException({
    message: 'Dados inválidos',
    issues: [{ path, message }],
  });
}

function generateRecoveryCode(): string {
  const chars = Array.from(
    { length: 8 },
    () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)],
  ).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

@Injectable()
export class TwoFactorService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
    private readonly box: SecretBox,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  // ---- Desafio do login -----------------------------------------------

  /** Senha conferida: token curto que só serve para mandar o código. */
  signChallenge(userId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, purpose: '2fa' },
      {
        expiresIn: TWO_FACTOR_CHALLENGE_TTL_SECONDS,
        issuer: JWT_ISSUER,
        audience: CHALLENGE_AUDIENCE,
        algorithm: 'HS256',
      },
    );
  }

  /** Id do usuário do desafio, ou null se faltar, vencer ou for adulterado. */
  async readChallenge(token: unknown): Promise<string | null> {
    if (typeof token !== 'string' || !token) return null;
    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        purpose: string;
      }>(token, {
        issuer: JWT_ISSUER,
        audience: CHALLENGE_AUDIENCE,
        algorithms: ['HS256'],
      });
      return payload.purpose === '2fa' ? payload.sub : null;
    } catch {
      return null;
    }
  }

  // ---- Conferência de código ------------------------------------------

  /**
   * Confere um código do app (6 dígitos) ou de recuperação (`xxxx-xxxx`).
   * Os dois são consumidos de forma atômica: o período TOTP avança e o código
   * de recuperação é marcado como usado num único UPDATE condicional, então
   * duas requisições com o mesmo código não passam juntas.
   */
  async verifyCredential(
    user: User,
    code: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<TwoFactorMethod | null> {
    if (!user.twoFactorSecret) return null;

    if (/^\d{6}$/.test(code)) {
      const lastStep =
        user.twoFactorLastStep === null ? null : Number(user.twoFactorLastStep);
      const step = verifyTotp(this.box.decrypt(user.twoFactorSecret), code, {
        afterStep: lastStep,
      });
      if (step === null) return null;
      const result = await manager
        .createQueryBuilder()
        .update(User)
        .set({ twoFactorLastStep: String(step) })
        .where('id = :id', { id: user.id })
        .andWhere(
          '(two_factor_last_step IS NULL OR two_factor_last_step < :step)',
          { step },
        )
        .execute();
      return result.affected ? 'totp' : null;
    }

    const result = await manager
      .getRepository(RecoveryCode)
      .update(
        { userId: user.id, codeHash: hashToken(code), usedAt: IsNull() },
        { usedAt: new Date() },
      );
    return result.affected ? 'recovery' : null;
  }

  // ---- Ativação e gestão (usuário logado) -----------------------------

  async status(user: User): Promise<TwoFactorStatusResponse> {
    const recoveryCodesLeft = user.twoFactorEnabledAt
      ? await this.dataSource
          .getRepository(RecoveryCode)
          .countBy({ userId: user.id, usedAt: IsNull() })
      : 0;
    return {
      enabled: user.twoFactorEnabledAt !== null,
      enabledAt: user.twoFactorEnabledAt?.toISOString() ?? null,
      recoveryCodesLeft,
    };
  }

  /** Passo 1: segredo pendente + QR code. Ainda não vale para o login. */
  async setup(user: User): Promise<TwoFactorSetupResponse> {
    if (user.twoFactorEnabledAt) {
      throw new ConflictException(
        'A verificação em duas etapas já está ativa.',
      );
    }
    const secret = generateTotpSecret();
    await this.dataSource
      .getRepository(User)
      .update(user.id, { twoFactorPendingSecret: this.box.encrypt(secret) });
    return { secret, otpauthUri: otpauthUri(secret, user.email) };
  }

  /** Passo 2: o primeiro código prova que o app foi configurado certo. */
  async enable(user: User, code: string, meta: RequestMeta): Promise<string[]> {
    if (user.twoFactorEnabledAt) {
      throw new ConflictException(
        'A verificação em duas etapas já está ativa.',
      );
    }
    if (!user.twoFactorPendingSecret) {
      throw invalidField('code', 'Comece a configuração de novo.');
    }
    const pending = this.box.decrypt(user.twoFactorPendingSecret);
    const step = verifyTotp(pending, code);
    if (step === null)
      throw invalidField(
        'code',
        'Código inválido. Confira o horário do celular.',
      );

    const codes = await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(User).update(user.id, {
        twoFactorSecret: user.twoFactorPendingSecret,
        twoFactorPendingSecret: null,
        twoFactorEnabledAt: new Date(),
        twoFactorLastStep: String(step),
      });
      const recoveryCodes = await this.replaceRecoveryCodes(user.id, manager);
      await this.audit.record(
        AuditEvent.TwoFactorEnabled,
        meta,
        user.id,
        {},
        manager,
      );
      return recoveryCodes;
    });
    this.mail.sendInBackground(twoFactorEnabledEmail(user.email, user.name));
    return codes;
  }

  /** Desativar exige senha + código: quem pegou a sessão aberta não consegue. */
  async disable(
    user: User,
    password: string,
    code: string,
    meta: RequestMeta,
  ): Promise<void> {
    if (!user.twoFactorEnabledAt) return;
    if (!(await this.hasher.verify(password, user.passwordHash))) {
      throw invalidField('password', 'Senha incorreta.');
    }
    await this.dataSource.transaction(async (manager) => {
      if (!(await this.verifyCredential(user, code, manager))) {
        throw invalidField('code', 'Código inválido ou expirado.');
      }
      await manager.getRepository(User).update(user.id, {
        twoFactorSecret: null,
        twoFactorPendingSecret: null,
        twoFactorEnabledAt: null,
        twoFactorLastStep: null,
      });
      await manager.getRepository(RecoveryCode).delete({ userId: user.id });
      await this.audit.record(
        AuditEvent.TwoFactorDisabled,
        meta,
        user.id,
        {},
        manager,
      );
    });
    this.mail.sendInBackground(twoFactorDisabledEmail(user.email, user.name));
  }

  async regenerateRecoveryCodes(
    user: User,
    code: string,
    meta: RequestMeta,
  ): Promise<string[]> {
    if (!user.twoFactorEnabledAt) {
      throw new ConflictException(
        'Ative a verificação em duas etapas primeiro.',
      );
    }
    return this.dataSource.transaction(async (manager) => {
      if (!(await this.verifyCredential(user, code, manager))) {
        throw invalidField('code', 'Código inválido ou expirado.');
      }
      const codes = await this.replaceRecoveryCodes(user.id, manager);
      await this.audit.record(
        AuditEvent.TwoFactorRecoveryRegenerated,
        meta,
        user.id,
        {},
        manager,
      );
      return codes;
    });
  }

  /** Apaga os códigos antigos e grava 10 novos (só o hash). */
  private async replaceRecoveryCodes(
    userId: string,
    manager: EntityManager,
  ): Promise<string[]> {
    const repo = manager.getRepository(RecoveryCode);
    await repo.delete({ userId });
    const codes = Array.from(
      { length: RECOVERY_CODES_COUNT },
      generateRecoveryCode,
    );
    await repo.insert(
      codes.map((code) => ({ userId, codeHash: hashToken(code) })),
    );
    return codes;
  }
}
