import type {
  BillingSettings,
  UpdateMerchantProfileInput,
} from '@kora/contracts';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
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

  /** Preferências salvas ou, se a loja nunca salvou, os padrões. */
  billingSettings(merchant: Merchant): BillingSettings {
    return (
      merchant.billingSettings ?? {
        defaultTolerance: '0.01',
        defaultWindowMinutes: '30',
        referenceCurrency: 'BRL',
        defaultNetwork: 'sepolia',
        acceptOverpayment: true,
        autoExpire: true,
        sendReceipt: false,
        notifyDetected: true,
        remindBeforeExpiry: false,
        senderEmail: merchant.email || 'nao-responda@korapag.com',
        returnUrl: merchant.website || 'https://app.korapag.com',
      }
    );
  }

  async updateBillingSettings(
    merchant: Merchant,
    settings: BillingSettings,
  ): Promise<void> {
    await this.merchants.update(merchant.id, { billingSettings: settings });
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
