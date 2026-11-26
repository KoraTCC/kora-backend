import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';

const SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 5_000;

interface SiteverifyResponse {
  success?: boolean;
  'error-codes'?: string[];
}

/** A Cloudflare não respondeu: não dá para dizer se o token é válido. */
export class TurnstileUnavailableError extends Error {}

/**
 * Valida no servidor o token gerado pelo widget do Cloudflare Turnstile.
 * Sem TURNSTILE_SECRET_KEY a checagem fica desligada (dev local e testes).
 */
@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);
  private readonly secret: string | undefined;

  constructor(@Inject(ENV) env: Env) {
    this.secret = env.TURNSTILE_SECRET_KEY;
    if (!this.secret && env.NODE_ENV === 'production') {
      this.logger.warn(
        'TURNSTILE_SECRET_KEY não definida: login e cadastro estão sem captcha.',
      );
    }
  }

  get enabled(): boolean {
    return Boolean(this.secret);
  }

  async verify(token: string, remoteIp?: string): Promise<boolean> {
    if (!this.secret) return true;

    const body = new URLSearchParams({ secret: this.secret, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);

    let result: SiteverifyResponse;
    try {
      const response = await fetch(SITEVERIFY_URL, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      result = (await response.json()) as SiteverifyResponse;
    } catch (error) {
      this.logger.error(`Falha ao consultar o Turnstile: ${String(error)}`);
      throw new TurnstileUnavailableError();
    }

    if (!result.success) {
      this.logger.debug(
        `Token do Turnstile recusado: ${(result['error-codes'] ?? []).join(', ')}`,
      );
    }
    return result.success === true;
  }
}
