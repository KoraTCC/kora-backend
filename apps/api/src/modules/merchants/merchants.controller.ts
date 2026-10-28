import {
  updateMerchantProfileSchema,
  type Acknowledgement,
  type MerchantResponse,
  type UpdateMerchantProfileInput,
} from '@kora/contracts';
import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AccessTokenGuard, CurrentUser } from '../auth/access-token.guard.js';
import type { User } from '../users/user.entity.js';
import { toMerchantResponse } from './merchant.mapper.js';
import { MerchantsService } from './merchants.service.js';

@Controller('merchants')
@UseGuards(AccessTokenGuard)
export class MerchantsController {
  constructor(
    private readonly merchants: MerchantsService,
    private readonly dataSource: DataSource,
  ) {}

  @Get('me')
  async me(@CurrentUser() user: User): Promise<MerchantResponse> {
    const merchant = await this.merchants.getOrCreateForUser(user);
    // Só leitura agregada; quem escreve em `charges` é o ChargesModule.
    const [row] = await this.dataSource.query<
      Array<{ charges: number; endpoints: number }>
    >(
      `SELECT (SELECT count(*) FROM charges WHERE merchant_id = $1)::int AS charges,
              (SELECT count(*) FROM webhook_endpoints WHERE merchant_id = $1)::int AS endpoints`,
      [merchant.id],
    );
    return toMerchantResponse(merchant, {
      chargesUsed: row?.charges ?? 0,
      webhookEndpointsUsed: row?.endpoints ?? 0,
    });
  }

  @Patch('me')
  async updateProfile(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updateMerchantProfileSchema))
    body: UpdateMerchantProfileInput,
  ): Promise<Acknowledgement> {
    const merchant = await this.merchants.getOrCreateForUser(user);
    await this.merchants.updateProfile(merchant, body);
    return { ok: true };
  }
}
