import {
  createWebhookEndpointSchema,
  updateWebhookEndpointSchema,
  updateWebhookSubscriptionSchema,
  type Acknowledgement,
  type CreateWebhookEndpointInput,
  type UpdateWebhookEndpointInput,
  type UpdateWebhookSubscriptionInput,
  type WebhookEndpointResponse,
  type WebhookSecretResponse,
  type WebhookStatsResponse,
  type WebhookSubscriptionItem,
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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AccessTokenGuard, CurrentUser } from '../auth/access-token.guard.js';
import { MerchantsService } from '../merchants/merchants.service.js';
import type { User } from '../users/user.entity.js';
import { WebhooksService } from './webhooks.service.js';

const endpointId = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@Controller('webhooks')
@UseGuards(AccessTokenGuard)
export class WebhooksController {
  constructor(
    private readonly merchants: MerchantsService,
    private readonly webhooks: WebhooksService,
  ) {}

  @Get('endpoints')
  async listEndpoints(
    @CurrentUser() user: User,
  ): Promise<WebhookEndpointResponse[]> {
    return this.webhooks.listEndpoints(
      await this.merchants.getOrCreateForUser(user),
    );
  }

  @Post('endpoints')
  async createEndpoint(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createWebhookEndpointSchema))
    body: CreateWebhookEndpointInput,
  ): Promise<Acknowledgement> {
    await this.webhooks.createEndpoint(
      await this.merchants.getOrCreateForUser(user),
      body,
    );
    return { ok: true };
  }

  @Patch('endpoints/:id')
  async updateEndpoint(
    @CurrentUser() user: User,
    @Param('id', endpointId) id: string,
    @Body(new ZodValidationPipe(updateWebhookEndpointSchema))
    body: UpdateWebhookEndpointInput,
  ): Promise<Acknowledgement> {
    await this.webhooks.updateEndpoint(
      await this.merchants.getOrCreateForUser(user),
      id,
      body,
    );
    return { ok: true };
  }

  @Delete('endpoints/:id')
  async removeEndpoint(
    @CurrentUser() user: User,
    @Param('id', endpointId) id: string,
  ): Promise<Acknowledgement> {
    await this.webhooks.removeEndpoint(
      await this.merchants.getOrCreateForUser(user),
      id,
    );
    return { ok: true };
  }

  @Get('subscription')
  async subscription(
    @CurrentUser() user: User,
  ): Promise<WebhookSubscriptionItem[]> {
    return this.webhooks.subscription(
      await this.merchants.getOrCreateForUser(user),
    );
  }

  @Put('subscription')
  async updateSubscription(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updateWebhookSubscriptionSchema))
    body: UpdateWebhookSubscriptionInput,
  ): Promise<Acknowledgement> {
    await this.webhooks.updateSubscription(
      await this.merchants.getOrCreateForUser(user),
      body.events,
    );
    return { ok: true };
  }

  @Get('secret')
  async secret(@CurrentUser() user: User): Promise<WebhookSecretResponse> {
    return this.webhooks.secret(await this.merchants.getOrCreateForUser(user));
  }

  @Get('stats')
  stats(): WebhookStatsResponse {
    return this.webhooks.stats();
  }

  // Ainda não há entrega de webhooks, então não há tentativas registradas.
  // `?limit=` (cartão "ao vivo") devolve lista; sem ele, a página do log.
  @Get('deliveries')
  deliveries(@Query('limit') limit?: string, @Query('page') page?: string) {
    if (limit !== undefined) return [];
    const current = Math.max(1, Number(page) || 1);
    return {
      items: [],
      page: current,
      pageSize: 16,
      total: 0,
      counts: { all: 0, success: 0, failed: 0, retrying: 0 },
    };
  }

  @Get('deliveries/latest-failure')
  latestFailure(): null {
    return null;
  }
}
