import {
  disableTwoFactorSchema,
  enableTwoFactorSchema,
  twoFactorCodeSchema,
  type Acknowledgement,
  type DisableTwoFactorInput,
  type EnableTwoFactorInput,
  type RecoveryCodesResponse,
  type TwoFactorCodeInput,
  type TwoFactorSetupResponse,
  type TwoFactorStatusResponse,
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
import type { User } from '../users/user.entity.js';
import { AccessTokenGuard, CurrentUser } from './access-token.guard.js';
import { AuthCookies } from './auth-cookies.service.js';
import { AuthService } from './auth.service.js';
import { TwoFactorService } from './two-factor.service.js';

@Controller('auth/2fa')
export class TwoFactorController {
  constructor(
    private readonly auth: AuthService,
    private readonly twoFactor: TwoFactorService,
    private readonly cookies: AuthCookies,
  ) {}

  /**
   * Segunda etapa do login. Sem login ainda: quem identifica o usuário é o
   * cookie de desafio (5 min) que o POST /auth/login deixou.
   */
  @Post('verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verify(
    @Req() req: Request,
    @Body(new ZodValidationPipe(twoFactorCodeSchema)) body: TwoFactorCodeInput,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Acknowledgement> {
    const challenge: unknown = req.cookies?.[this.cookies.twoFactorName];
    const { tokens } = await this.auth.completeTwoFactorLogin(
      challenge,
      body.code,
      meta,
    );
    this.cookies.clearTwoFactorChallenge(res);
    this.cookies.set(res, tokens);
    return { ok: true };
  }

  @Get()
  @UseGuards(AccessTokenGuard)
  status(@CurrentUser() user: User): Promise<TwoFactorStatusResponse> {
    return this.twoFactor.status(user);
  }

  @Post('setup')
  @HttpCode(200)
  @UseGuards(AccessTokenGuard)
  setup(@CurrentUser() user: User): Promise<TwoFactorSetupResponse> {
    return this.twoFactor.setup(user);
  }

  @Post('enable')
  @HttpCode(200)
  @UseGuards(AccessTokenGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async enable(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(enableTwoFactorSchema))
    body: EnableTwoFactorInput,
    @ReqMeta() meta: RequestMeta,
  ): Promise<RecoveryCodesResponse> {
    return {
      recoveryCodes: await this.twoFactor.enable(user, body.code, meta),
    };
  }

  @Post('disable')
  @HttpCode(200)
  @UseGuards(AccessTokenGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async disable(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(disableTwoFactorSchema))
    body: DisableTwoFactorInput,
    @ReqMeta() meta: RequestMeta,
  ): Promise<Acknowledgement> {
    await this.twoFactor.disable(user, body.password, body.code, meta);
    return { ok: true };
  }

  @Post('recovery-codes')
  @HttpCode(200)
  @UseGuards(AccessTokenGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async regenerate(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(twoFactorCodeSchema)) body: TwoFactorCodeInput,
    @ReqMeta() meta: RequestMeta,
  ): Promise<RecoveryCodesResponse> {
    return {
      recoveryCodes: await this.twoFactor.regenerateRecoveryCodes(
        user,
        body.code,
        meta,
      ),
    };
  }
}
