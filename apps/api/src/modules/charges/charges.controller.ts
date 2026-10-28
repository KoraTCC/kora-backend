import {
  createChargeSchema,
  listChargesQuerySchema,
  simulateChargeSchema,
  type Acknowledgement,
  type ChargeDetailResponse,
  type ChargePageResponse,
  type ChargeStatsResponse,
  type CreateChargeInput,
  type ListChargesQuery,
  type SimulateChargeInput,
} from '@kora/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ReqMeta, type RequestMeta } from '../../common/request-meta.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AccessTokenGuard, CurrentUser } from '../auth/access-token.guard.js';
import { MerchantsService } from '../merchants/merchants.service.js';
import type { User } from '../users/user.entity.js';
import { ChargesService } from './charges.service.js';

// UUID inválido na URL vira 404, como uma cobrança que não existe.
const chargeId = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@Controller('charges')
@UseGuards(AccessTokenGuard)
export class ChargesController {
  constructor(
    private readonly merchants: MerchantsService,
    private readonly charges: ChargesService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(listChargesQuerySchema))
    query: ListChargesQuery,
  ): Promise<ChargePageResponse> {
    return this.charges.list(
      await this.merchants.getOrCreateForUser(user),
      query,
    );
  }

  // Declarada antes de `:id` para "stats" não ser lido como id.
  @Get('stats')
  async stats(@CurrentUser() user: User): Promise<ChargeStatsResponse> {
    return this.charges.stats(await this.merchants.getOrCreateForUser(user));
  }

  @Get(':id')
  async get(
    @CurrentUser() user: User,
    @Param('id', chargeId) id: string,
  ): Promise<ChargeDetailResponse> {
    return this.charges.get(await this.merchants.getOrCreateForUser(user), id);
  }

  @Post()
  @HttpCode(201)
  async create(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createChargeSchema)) body: CreateChargeInput,
    @ReqMeta() meta: RequestMeta,
  ): Promise<{ id: string }> {
    return this.charges.create(
      await this.merchants.getOrCreateForUser(user),
      body,
      meta,
    );
  }

  @Post(':id/simulate')
  @HttpCode(200)
  async simulate(
    @CurrentUser() user: User,
    @Param('id', chargeId) id: string,
    @Body(new ZodValidationPipe(simulateChargeSchema))
    body: SimulateChargeInput,
    @ReqMeta() meta: RequestMeta,
  ): Promise<Acknowledgement> {
    await this.charges.simulate(
      await this.merchants.getOrCreateForUser(user),
      id,
      body,
      meta,
    );
    return { ok: true };
  }
}
