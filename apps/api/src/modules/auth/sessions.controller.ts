import type { Acknowledgement } from '@kora/contracts';
import {
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ReqMeta, type RequestMeta } from '../../common/request-meta.js';
import { AuditEvent } from '../audit/audit-log.entity.js';
import { AuditService } from '../audit/audit.service.js';
import type { User } from '../users/user.entity.js';
import {
  AccessTokenGuard,
  CurrentSessionId,
  CurrentUser,
} from './access-token.guard.js';
import { describeDevice } from './describe-device.js';
import { SessionService } from './session.service.js';

/** Sem geolocalização por IP por enquanto: não inventamos uma cidade. */
const UNKNOWN_LOCATION = 'Local não identificado';

interface SessionResponse {
  id: string;
  device: string;
  location: string;
  ip: string;
  lastActiveAt: string;
  isCurrent: boolean;
}

interface AccessLogResponse {
  id: string;
  at: string;
  isSuccess: boolean;
  location: string;
}

@Controller()
@UseGuards(AccessTokenGuard)
export class SessionsController {
  constructor(
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /** Dispositivos com sessão ativa (uma linha por família de refresh tokens). */
  @Get('sessions')
  async list(
    @CurrentUser() user: User,
    @CurrentSessionId() currentId: string,
  ): Promise<SessionResponse[]> {
    const sessions = await this.sessions.listActive(user.id);
    return sessions.map((session) => ({
      id: session.familyId,
      device: describeDevice(session.userAgent),
      location: UNKNOWN_LOCATION,
      ip: session.ip ?? '—',
      lastActiveAt: session.lastActiveAt.toISOString(),
      isCurrent: session.familyId === currentId,
    }));
  }

  // Declarada antes de `:id` para "others" não ser lido como id.
  @Delete('sessions/others')
  async endOthers(
    @CurrentUser() user: User,
    @CurrentSessionId() currentId: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<Acknowledgement> {
    const count = await this.sessions.revokeOtherSessions(user.id, currentId);
    if (count > 0) {
      await this.audit.record(AuditEvent.SessionRevoked, meta, user.id, {
        scope: 'others',
      });
    }
    return { ok: true };
  }

  @Delete('sessions/:id')
  async end(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<Acknowledgement> {
    if (!(await this.sessions.revokeSession(user.id, id))) {
      throw new NotFoundException('Sessão não encontrada.');
    }
    await this.audit.record(AuditEvent.SessionRevoked, meta, user.id, {
      familyId: id,
    });
    return { ok: true };
  }

  @Get('security/access-log')
  async accessLog(@CurrentUser() user: User): Promise<AccessLogResponse[]> {
    const entries = await this.audit.listLoginAttempts(user.id);
    return entries.map((entry) => ({
      id: entry.id,
      at: entry.createdAt.toISOString(),
      isSuccess: entry.event === AuditEvent.LoginSuccess,
      location: entry.ip ? `IP ${entry.ip}` : UNKNOWN_LOCATION,
    }));
  }
}
