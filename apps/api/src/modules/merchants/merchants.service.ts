import type { UpdateMerchantProfileInput, WebhookEvent } from '@kora/contracts';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import { IsNull, type Repository } from 'typeorm';
import type { User } from '../users/user.entity.js';
import { Merchant } from './merchant.entity.js';

@Injectable()
export class MerchantsService {
  constructor(
    @InjectRepository(Merchant)
    private readonly merchants: Repository<Merchant>,
  ) {}

  /**
   * Merchant do usuário logado. Na primeira chamada cria um merchant padrão
   * em modo teste; isso cobre também as contas criadas antes deste módulo.
   */
  async getOrCreateForUser(user: User): Promise<Merchant> {
    const existing = await this.merchants.findOneBy({ userId: user.id });
    if (existing) return existing;

    // ON CONFLICT: duas requisições simultâneas no primeiro acesso não
    // criam dois merchants (user_id é UNIQUE).
    await this.merchants
      .createQueryBuilder()
      .insert()
      .values({
        userId: user.id,
        name: user.name,
        displayName: user.name,
        email: user.email,
      })
      .orIgnore()
      .execute();
    return this.merchants.findOneByOrFail({ userId: user.id });
  }

  async updateProfile(
    merchant: Merchant,
    input: UpdateMerchantProfileInput,
  ): Promise<void> {
    await this.merchants.update(merchant.id, {
      ...input,
      document: input.document.replace(/\D/g, ''),
      postalCode: input.postalCode.replace(/\D/g, ''),
      state: input.state.toUpperCase(),
      country: input.country.toUpperCase(),
    });
  }

  async updateWebhookEvents(
    merchant: Merchant,
    events: WebhookEvent[],
  ): Promise<void> {
    await this.merchants.update(merchant.id, {
      webhookEvents: [...new Set(events)],
    });
  }

  /** Gera o segredo de webhook no primeiro acesso e devolve o atual. */
  async ensureWebhookSecret(merchant: Merchant): Promise<string> {
    if (merchant.webhookSecret) return merchant.webhookSecret;
    // Só grava se ainda estiver vazio: duas abas não geram segredos diferentes.
    await this.merchants.update(
      { id: merchant.id, webhookSecret: IsNull() },
      { webhookSecret: `whsec_${randomBytes(24).toString('base64url')}` },
    );
    const { webhookSecret } = await this.merchants.findOneByOrFail({
      id: merchant.id,
    });
    return webhookSecret!;
  }

  async updateEnabledNetworks(
    merchant: Merchant,
    enabledNetworks: Merchant['enabledNetworks'],
  ): Promise<void> {
    await this.merchants.update(merchant.id, {
      enabledNetworks: [...new Set(enabledNetworks)],
    });
  }
}
