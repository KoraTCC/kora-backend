import { Inject, Injectable } from '@nestjs/common';
import type { CookieOptions, Response } from 'express';
import { ENV, type Env } from '../../config/env.js';
import type { SessionTokens } from './session.service.js';

/** O refresh token só é enviado para as rotas de autenticação. */
export const REFRESH_COOKIE_PATH = '/auth';

/**
 * Tokens só em cookies httpOnly: o JavaScript da página (e um eventual XSS)
 * não consegue lê-los, ao contrário do localStorage.
 *
 * Com HTTPS os nomes usam prefixos que o navegador faz valer:
 * `__Host-` exige Secure, Path=/ e nenhum Domain (cookie preso ao host da API);
 * `__Secure-` exige Secure.
 */
@Injectable()
export class AuthCookies {
  readonly accessName: string;
  readonly refreshName: string;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.accessName = env.COOKIE_SECURE ? '__Host-kora_at' : 'kora_at';
    this.refreshName = env.COOKIE_SECURE ? '__Secure-kora_rt' : 'kora_rt';
  }

  set(res: Response, tokens: SessionTokens): void {
    res.cookie(this.accessName, tokens.accessToken, {
      ...this.base(),
      sameSite: 'lax',
      path: '/',
      maxAge: this.env.ACCESS_TOKEN_TTL_SECONDS * 1000,
    });
    res.cookie(this.refreshName, tokens.refreshToken, {
      ...this.base(),
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      maxAge: this.env.REFRESH_TOKEN_TTL_SECONDS * 1000,
    });
  }

  clear(res: Response): void {
    res.clearCookie(this.accessName, {
      ...this.base(),
      sameSite: 'lax',
      path: '/',
    });
    res.clearCookie(this.refreshName, {
      ...this.base(),
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
    });
  }

  private base(): CookieOptions {
    return { httpOnly: true, secure: this.env.COOKIE_SECURE };
  }
}
