import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** Dados da requisição guardados em sessões e na auditoria. */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export const ReqMeta = createParamDecorator(
  (_: unknown, context: ExecutionContext): RequestMeta => {
    const req = context.switchToHttp().getRequest<Request>();
    return {
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent']?.slice(0, 512) ?? null,
    };
  },
);
