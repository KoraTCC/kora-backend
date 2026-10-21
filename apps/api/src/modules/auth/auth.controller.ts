import {
  registerSchema,
  type AuthResponse,
  type RegisterInput,
} from '@kora/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ReqMeta, type RequestMeta } from '../../common/request-meta.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { toUserResponse } from '../users/user.mapper.js';
import type { User } from '../users/user.entity.js';
import { AccessTokenGuard, CurrentUser } from './access-token.guard.js';
import { AuthCookies } from './auth-cookies.service.js';
import { AuthService } from './auth.service.js';

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
}
