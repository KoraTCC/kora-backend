import {
  WEBHOOK_ENDPOINTS_LIMIT,
  WEBHOOK_EVENTS,
  type CreateWebhookEndpointInput,
  type UpdateWebhookEndpointInput,
  type WebhookEndpointResponse,
  type WebhookEvent,
  type WebhookSecretResponse,
  type WebhookStatsResponse,
  type WebhookSubscriptionItem,
} from '@kora/contracts';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, type Repository } from 'typeorm';
import type { Merchant } from '../merchants/merchant.entity.js';
import { MerchantsService } from '../merchants/merchants.service.js';
import { WebhookEndpoint } from './webhook-endpoint.entity.js';
import { unsafeWebhookUrlReason } from './webhook-url.js';

const UNIQUE_VIOLATION = '23505';

@Injectable()
export class WebhooksService {
  constructor(
    @InjectRepository(WebhookEndpoint)
    private readonly endpoints: Repository<WebhookEndpoint>,
    private readonly merchants: MerchantsService,
  ) {}

  async listEndpoints(merchant: Merchant): Promise<WebhookEndpointResponse[]> {
    const endpoints = await this.endpoints.find({
      where: { merchantId: merchant.id },
      order: { createdAt: 'ASC' },
    });
    return endpoints.map((endpoint) => ({
      id: endpoint.id,
      url: endpoint.url,
      status: endpoint.status,
      events: merchant.webhookEvents,
      // A entrega de webhooks ainda não existe: sem histórico de envio.
      lastDeliveryAt: null,
      consecutiveFailures: 0,
      nextRetryAt: null,
    }));
  }

  countEndpoints(merchant: Merchant): Promise<number> {
    return this.endpoints.countBy({ merchantId: merchant.id });
  }

  async createEndpoint(
    merchant: Merchant,
    input: CreateWebhookEndpointInput,
  ): Promise<void> {
    const reason = unsafeWebhookUrlReason(input.url);
    if (reason) {
      throw new BadRequestException({
        message: 'Dados inválidos',
        issues: [{ path: 'url', message: reason }],
      });
    }
    if ((await this.countEndpoints(merchant)) >= WEBHOOK_ENDPOINTS_LIMIT) {
      throw new ConflictException(
        `Seu plano permite até ${WEBHOOK_ENDPOINTS_LIMIT} endpoints.`,
      );
    }
    try {
      await this.endpoints.insert({ merchantId: merchant.id, url: input.url });
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === UNIQUE_VIOLATION
      ) {
        throw new ConflictException('Esse endpoint já está cadastrado.');
      }
      throw error;
    }
  }

  async updateEndpoint(
    merchant: Merchant,
    id: string,
    input: UpdateWebhookEndpointInput,
  ): Promise<void> {
    const result = await this.endpoints.update(
      { id, merchantId: merchant.id },
      { status: input.status },
    );
    if (!result.affected)
      throw new NotFoundException('Endpoint não encontrado.');
  }

  async removeEndpoint(merchant: Merchant, id: string): Promise<void> {
    const result = await this.endpoints.delete({ id, merchantId: merchant.id });
    if (!result.affected)
      throw new NotFoundException('Endpoint não encontrado.');
  }

  subscription(merchant: Merchant): WebhookSubscriptionItem[] {
    return WEBHOOK_EVENTS.map((event) => ({
      event,
      isEnabled: merchant.webhookEvents.includes(event),
    }));
  }

  async updateSubscription(
    merchant: Merchant,
    events: WebhookEvent[],
  ): Promise<void> {
    await this.merchants.updateWebhookEvents(merchant, events);
  }

  async secret(merchant: Merchant): Promise<WebhookSecretResponse> {
    return {
      secret: await this.merchants.ensureWebhookSecret(merchant),
      algorithm: 'HMAC-SHA256',
    };
  }

  /** Sem entregas ainda: indicadores zerados, mas reais. */
  stats(): WebhookStatsResponse {
    return {
      delivered: 0,
      successRate: 0,
      successTarget: 0.99,
      failing: 0,
      retryingEndpoints: 0,
      averageLatencyMs: 0,
      p95LatencyMs: 0,
    };
  }
}
