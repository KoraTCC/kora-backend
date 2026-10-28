import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager, Repository } from 'typeorm';
import type { RequestMeta } from '../../common/request-meta.js';
import {
  AuditEvent,
  AuditLog,
  type AuditMetadata,
} from './audit-log.entity.js';

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  /** Últimas tentativas de login do usuário (para a tela de segurança). */
  listLoginAttempts(userId: string, limit = 10): Promise<AuditLog[]> {
    return this.repo.find({
      where: [
        { userId, event: AuditEvent.LoginSuccess },
        { userId, event: AuditEvent.LoginFailure },
      ],
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /** Registra um evento. Passe `manager` para gravar dentro de uma transação. */
  async record(
    event: AuditEvent,
    meta: RequestMeta,
    userId: string | null,
    metadata: AuditMetadata = {},
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager?.getRepository(AuditLog) ?? this.repo;
    await repo.insert({ event, userId, metadata, ...meta });
  }
}
