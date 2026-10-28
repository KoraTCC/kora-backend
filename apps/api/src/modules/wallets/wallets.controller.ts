import {
  addWalletSchema,
  updateNetworkSettingsSchema,
  type Acknowledgement,
  type AddWalletInput,
  type NetworkSettingResponse,
  type UpdateNetworkSettingsInput,
  type WalletResponse,
} from '@kora/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AccessTokenGuard, CurrentUser } from '../auth/access-token.guard.js';
import { MerchantsService } from '../merchants/merchants.service.js';
import type { User } from '../users/user.entity.js';
import { WalletsService } from './wallets.service.js';

@Controller()
@UseGuards(AccessTokenGuard)
export class WalletsController {
  constructor(
    private readonly merchants: MerchantsService,
    private readonly wallets: WalletsService,
  ) {}

  @Get('wallets')
  async list(@CurrentUser() user: User): Promise<WalletResponse[]> {
    return this.wallets.list(await this.merchants.getOrCreateForUser(user));
  }

  @Post('wallets')
  async add(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(addWalletSchema)) body: AddWalletInput,
  ): Promise<Acknowledgement> {
    await this.wallets.add(await this.merchants.getOrCreateForUser(user), body);
    return { ok: true };
  }

  @Delete('wallets/:id')
  async remove(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ): Promise<Acknowledgement> {
    await this.wallets.remove(
      await this.merchants.getOrCreateForUser(user),
      id,
    );
    return { ok: true };
  }

  @Get('networks')
  async networks(@CurrentUser() user: User): Promise<NetworkSettingResponse[]> {
    return this.wallets.networkSettings(
      await this.merchants.getOrCreateForUser(user),
    );
  }

  @Patch('networks')
  async updateNetworks(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updateNetworkSettingsSchema))
    body: UpdateNetworkSettingsInput,
  ): Promise<Acknowledgement> {
    const merchant = await this.merchants.getOrCreateForUser(user);
    await this.merchants.updateEnabledNetworks(merchant, body.enabledNetworks);
    return { ok: true };
  }
}
