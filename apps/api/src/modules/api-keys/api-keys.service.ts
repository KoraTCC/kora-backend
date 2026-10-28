import {
  API_SECRET_KEYS_LIMIT,
  type ApiKeyResponse,
  type TestCredentialsResponse,
} from '@kora/contracts';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import {
  DataSource,
  IsNull,
  type EntityManager,
  type Repository,
} from 'typeorm';
import type { RequestMeta } from '../../common/request-meta.js';
import { AuditEvent } from '../audit/audit-log.entity.js';
import { AuditService } from '../audit/audit.service.js';
import { hashToken } from '../auth/session.service.js';
import type { Merchant } from '../merchants/merchant.entity.js';
import { ApiKey } from './api-key.entity.js';

function mask(key: ApiKey): string {
  return `${key.prefix}…${key.last4}`;
}

function toResponse(key: ApiKey): ApiKeyResponse {
  return {
    id: key.id,
    maskedKey: mask(key),
    kind: key.kind,
    createdAt: key.createdAt.toISOString(),
    // Autenticação por chave de API ainda não existe: sem uso registrado.
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    callsLast7d: 0,
  };
}

@Injectable()
export class ApiKeysService {
  constructor(
    @InjectRepository(ApiKey) private readonly keys: Repository<ApiKey>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async list(merchant: Merchant): Promise<ApiKeyResponse[]> {
    await this.ensurePublishable(merchant);
    const keys = await this.keys.find({
      where: { merchantId: merchant.id, revokedAt: IsNull() },
      order: { createdAt: 'ASC' },
    });
    return keys.map(toResponse);
  }

  async testCredentials(merchant: Merchant): Promise<TestCredentialsResponse> {
    const publishable = await this.ensurePublishable(merchant);
    const secret = await this.keys.findOne({
      where: { merchantId: merchant.id, kind: 'secret', revokedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    return {
      publishableKey: publishable.publicKey!,
      secretKey: secret ? mask(secret) : '',
    };
  }

  async createSecret(merchant: Merchant, meta: RequestMeta): Promise<string> {
    return this.dataSource.transaction(async (manager) => {
      const active = await manager.getRepository(ApiKey).countBy({
        merchantId: merchant.id,
        kind: 'secret',
        revokedAt: IsNull(),
      });
      if (active >= API_SECRET_KEYS_LIMIT) {
        throw new ConflictException(
          `Limite de ${API_SECRET_KEYS_LIMIT} chaves secretas ativas. Revogue uma antes.`,
        );
      }
      return this.insertSecret(merchant, meta, manager);
    });
  }

  /** Revoga a chave secreta mais recente e cria outra, numa transação. */
  async rotateSecret(merchant: Merchant, meta: RequestMeta): Promise<string> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ApiKey);
      const current = await repo.findOne({
        where: { merchantId: merchant.id, kind: 'secret', revokedAt: IsNull() },
        order: { createdAt: 'DESC' },
      });
      if (current) {
        await repo.update(current.id, { revokedAt: new Date() });
        await this.audit.record(
          AuditEvent.ApiKeyRevoked,
          meta,
          merchant.userId,
          { apiKeyId: current.id, reason: 'rotation' },
          manager,
        );
      }
      return this.insertSecret(merchant, meta, manager);
    });
  }

  async revoke(
    merchant: Merchant,
    id: string,
    meta: RequestMeta,
  ): Promise<void> {
    const result = await this.keys.update(
      { id, merchantId: merchant.id, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    if (!result.affected) throw new NotFoundException('Chave não encontrada.');
    await this.audit.record(AuditEvent.ApiKeyRevoked, meta, merchant.userId, {
      apiKeyId: id,
    });
  }

  private async insertSecret(
    merchant: Merchant,
    meta: RequestMeta,
    manager: EntityManager,
  ): Promise<string> {
    const key = `sk_test_${randomBytes(32).toString('base64url')}`;
    const { identifiers } = await manager.getRepository(ApiKey).insert({
      merchantId: merchant.id,
      kind: 'secret',
      prefix: key.slice(0, 12),
      last4: key.slice(-4),
      keyHash: hashToken(key),
    });
    await this.audit.record(
      AuditEvent.ApiKeyCreated,
      meta,
      merchant.userId,
      { apiKeyId: (identifiers[0] as { id: string }).id },
      manager,
    );
    return key;
  }

  /** A chave publicável é criada sozinha no primeiro acesso. */
  private async ensurePublishable(merchant: Merchant): Promise<ApiKey> {
    const where = {
      merchantId: merchant.id,
      kind: 'publishable' as const,
      revokedAt: IsNull(),
    };
    const existing = await this.keys.findOne({
      where,
      order: { createdAt: 'DESC' },
    });
    if (existing) return existing;

    const key = `pk_test_${randomBytes(18).toString('base64url')}`;
    await this.keys.insert({
      merchantId: merchant.id,
      kind: 'publishable',
      prefix: key.slice(0, 12),
      last4: key.slice(-4),
      publicKey: key,
    });
    return this.keys.findOneOrFail({ where, order: { createdAt: 'DESC' } });
  }
}
