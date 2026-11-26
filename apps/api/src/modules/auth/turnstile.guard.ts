import {
  BadRequestException,
  type CanActivate,
  type ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  TurnstileService,
  TurnstileUnavailableError,
} from './turnstile.service.js';

/** Campo do body com o token do widget. O ZodValidationPipe o descarta depois. */
export const TURNSTILE_FIELD = 'turnstileToken';
const MAX_TOKEN_LENGTH = 2048;

/**
 * Exige um token válido do Cloudflare Turnstile nas rotas públicas que bots
 * gostam de martelar (login e cadastro). Roda depois do
 * ThrottlerGuard global, então o rate limit continua valendo antes da
 * chamada à Cloudflare.
 */
@Injectable()
export class TurnstileGuard implements CanActivate {
  constructor(private readonly turnstile: TurnstileService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.turnstile.enabled) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const body = req.body as Record<string, unknown> | undefined;
    const token = body?.[TURNSTILE_FIELD];
    if (
      typeof token !== 'string' ||
      token.length === 0 ||
      token.length > MAX_TOKEN_LENGTH
    ) {
      throw new BadRequestException('Confirme que você não é um robô.');
    }

    let valid: boolean;
    try {
      valid = await this.turnstile.verify(token, req.ip);
    } catch (error) {
      if (error instanceof TurnstileUnavailableError) {
        throw new ServiceUnavailableException(
          'Não foi possível validar o captcha. Tente de novo.',
        );
      }
      throw error;
    }
    if (!valid) {
      throw new BadRequestException(
        'A verificação anti-robô expirou ou falhou. Tente de novo.',
      );
    }
    return true;
  }
}
