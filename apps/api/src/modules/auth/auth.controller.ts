import {
  loginSchema,
  registerSchema,
  type AuthResponse,
  type LoginInput,
  type RegisterInput,
} from '@kora/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ReqMeta, type RequestMeta } from '../../common/request-meta.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { toUserResponse } from '../users/user.mapper.js';
import type { User } from '../users/user.entity.js';
import { AccessTokenGuard, CurrentUser } from './access-token.guard.js';
import { AuthCookies } from './auth-cookies.service.js';
import { AuthService, SupersededRefreshError } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: AuthCookies,
  ) {}

  @Post('register')
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { user, tokens } = await this.auth.register(body, meta);
    this.cookies.set(res, tokens);
    return { user };
  }

  /** Usuário da sessão atual. O front usa para saber se está logado. */
  @Get('me')
  @UseGuards(AccessTokenGuard)
  me(@CurrentUser() user: User): AuthResponse {
    return { user: toUserResponse(user) };
  }

  /**
   * Renova a sessão com o refresh token (cookie restrito a `/auth`).
   * Em qualquer falha os cookies são apagados: o front volta ao login.
   */
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(
    @Req() req: Request,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const token: unknown = req.cookies?.[this.cookies.refreshName];
    try {
      const { user, tokens } = await this.auth.refresh(
        typeof token === 'string' ? token : '',
        meta,
      );
      this.cookies.set(res, tokens);
      return { user };
    } catch (error) {
      if (!(error instanceof SupersededRefreshError)) this.cookies.clear(res);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async logout(
    @Req() req: Request,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token: unknown = req.cookies?.[this.cookies.refreshName];
    try {
      await this.auth.logout(typeof token === 'string' ? token : '', meta);
    } finally {
      this.cookies.clear(res);
    }
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { user, tokens } = await this.auth.login(body, meta);
    this.cookies.set(res, tokens);
    return { user };
  }
}
