import {
  CHARGE_STATUSES,
  NETWORK_META,
  type ChargeDetailResponse,
  type ChargePageResponse,
  type ChargeStatsResponse,
  type CheckoutResponse,
  type CreateChargeInput,
  type ListChargesQuery,
  type SimulateChargeInput,
  type StatusCounts,
} from '@kora/contracts';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes, randomInt } from 'node:crypto';
import { Brackets, DataSource, type Repository } from 'typeorm';
import type { RequestMeta } from '../../common/request-meta.js';
import { AuditEvent } from '../audit/audit-log.entity.js';
import { AuditService } from '../audit/audit.service.js';
import type { Merchant } from '../merchants/merchant.entity.js';
import { WalletsService } from '../wallets/wallets.service.js';
import { Charge } from './charge.entity.js';
import {
  toChargeDetailResponse,
  toChargeResponse,
  toCheckoutResponse,
} from './charge.mapper.js';
import { DEMO_RATES_CENTS, halfOf, quoteCryptoAmount } from './quote.js';

function invalidField(path: string, message: string): BadRequestException {
  return new BadRequestException({
    message: 'Dados inválidos',
    issues: [{ path, message }],
  });
}

function emptyCounts(): StatusCounts {
  return Object.fromEntries(CHARGE_STATUSES.map((s) => [s, 0])) as StatusCounts;
}

/** Variação relativa: 0.124 = +12,4%. Sem base anterior, 0. */
function delta(current: number, previous: number): number {
  return previous === 0 ? 0 : (current - previous) / previous;
}

@Injectable()
export class ChargesService {
  constructor(
    @InjectRepository(Charge) private readonly charges: Repository<Charge>,
    private readonly wallets: WalletsService,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  async create(
    merchant: Merchant,
    input: CreateChargeInput,
    meta: RequestMeta,
  ): Promise<{ id: string }> {
    if (!merchant.enabledNetworks.includes(input.network)) {
      throw invalidField(
        'network',
        'Essa rede está desativada nas configurações',
      );
    }
    const wallet = await this.wallets
      .findOwned(merchant, input.walletId)
      .catch(() => null);
    if (!wallet || wallet.network !== input.network) {
      throw invalidField('walletId', 'Escolha uma carteira dessa rede');
    }

    const meta_ = NETWORK_META[input.network];
    return this.dataSource.transaction(async (manager) => {
      const charge = await manager.getRepository(Charge).save(
        manager.getRepository(Charge).create({
          merchantId: merchant.id,
          walletId: wallet.id,
          reference: input.reference,
          origin: 'payment-link',
          customerEmail: input.customerEmail || null,
          description: input.description,
          amountCents: input.amountCents,
          cryptoAmount: quoteCryptoAmount(input.amountCents, input.network),
          asset: meta_.asset,
          network: input.network,
          address: wallet.address,
          requiredConfirmations: meta_.requiredConfirmations,
          tolerance: input.tolerance,
          lockedRateCents: String(DEMO_RATES_CENTS[input.network]),
          expiresAt: new Date(
            Date.now() + Number(input.expiresInMinutes) * 60_000,
          ),
        }),
      );
      await this.audit.record(
        AuditEvent.ChargeCreated,
        meta,
        merchant.userId,
        { chargeId: charge.id, amountCents: charge.amountCents },
        manager,
      );
      return { id: charge.id };
    });
  }

  async list(
    merchant: Merchant,
    query: ListChargesQuery,
  ): Promise<ChargePageResponse> {
    await this.expireOverdue(merchant);

    const qb = this.charges
      .createQueryBuilder('c')
      .where('c.merchant_id = :merchantId', { merchantId: merchant.id });
    if (query.status)
      qb.andWhere('c.status = :status', { status: query.status });
    if (query.network)
      qb.andWhere('c.network = :network', { network: query.network });
    if (query.q) {
      const like = `%${query.q.replace(/[\\%_]/g, '\\$&')}%`;
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('c.id::text ILIKE :like', { like })
            .orWhere('c.reference ILIKE :like', { like })
            .orWhere('c.customer_email ILIKE :like', { like }),
        ),
      );
    }

    const [items, total] = await qb
      .orderBy('c.created_at', 'DESC')
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getManyAndCount();

    // `counts` e `totalAll` ignoram os filtros: alimentam as abas de status.
    const counts = await this.countByStatus(merchant);
    const totalAll = Object.values(counts).reduce((a, b) => a + b, 0);

    return {
      items: items.map(toChargeResponse),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalAll,
      counts,
    };
  }

  async get(merchant: Merchant, id: string): Promise<ChargeDetailResponse> {
    await this.expireOverdue(merchant);
    return toChargeDetailResponse(await this.findOwned(merchant, id));
  }

  async stats(merchant: Merchant): Promise<ChargeStatsResponse> {
    await this.expireOverdue(merchant);
    const counts = await this.countByStatus(merchant);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    const [row] = await this.dataSource.query<
      Array<{
        pending_cents: string;
        received_cents: string;
        average_ticket_cents: string | null;
        median_confirm_minutes: string | null;
        confirmed_7d: number;
        confirmed_prev_7d: number;
        received_7d: string;
        received_prev_7d: string;
      }>
    >(
      `SELECT
         coalesce(sum(amount_cents) FILTER (WHERE status IN ('pending','detected')), 0) AS pending_cents,
         coalesce(sum(amount_cents) FILTER (WHERE status = 'confirmed'), 0) AS received_cents,
         avg(amount_cents) FILTER (WHERE status = 'confirmed') AS average_ticket_cents,
         percentile_cont(0.5) WITHIN GROUP (
           ORDER BY extract(epoch FROM confirmed_at - created_at) / 60
         ) FILTER (WHERE status = 'confirmed') AS median_confirm_minutes,
         count(*) FILTER (WHERE status = 'confirmed'
           AND confirmed_at > now() - interval '7 days')::int AS confirmed_7d,
         count(*) FILTER (WHERE status = 'confirmed'
           AND confirmed_at <= now() - interval '7 days'
           AND confirmed_at > now() - interval '14 days')::int AS confirmed_prev_7d,
         coalesce(sum(amount_cents) FILTER (WHERE status = 'confirmed'
           AND confirmed_at > now() - interval '7 days'), 0) AS received_7d,
         coalesce(sum(amount_cents) FILTER (WHERE status = 'confirmed'
           AND confirmed_at <= now() - interval '7 days'
           AND confirmed_at > now() - interval '14 days'), 0) AS received_prev_7d
       FROM charges WHERE merchant_id = $1`,
      [merchant.id],
    );

    // Conversão: confirmadas sobre as que já terminaram (sem contar as em aberto).
    const finished = total - counts.pending - counts.detected;
    return {
      counts,
      total,
      pendingAmountCents: Number(row?.pending_cents ?? 0),
      confirmedDelta: delta(
        row?.confirmed_7d ?? 0,
        row?.confirmed_prev_7d ?? 0,
      ),
      receivedCents: Number(row?.received_cents ?? 0),
      receivedDelta: delta(
        Number(row?.received_7d ?? 0),
        Number(row?.received_prev_7d ?? 0),
      ),
      averageTicketCents: Math.round(Number(row?.average_ticket_cents ?? 0)),
      conversionRate: finished === 0 ? 0 : counts.confirmed / finished,
      medianConfirmMinutes:
        Math.round(Number(row?.median_confirm_minutes ?? 0) * 10) / 10,
    };
  }

  /**
   * Simula o pagamento de uma cobrança. Só em modo teste: substitui a
   * detecção on-chain até a integração com o provedor (MVP 2).
   */
  async simulate(
    merchant: Merchant,
    id: string,
    input: SimulateChargeInput,
    meta: RequestMeta,
  ): Promise<void> {
    if (merchant.environment !== 'test') {
      throw new ConflictException('Simulação disponível apenas em modo teste.');
    }
    await this.expireOverdue(merchant);

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Charge);
      // Lock: duas simulações simultâneas não processam a mesma cobrança.
      const charge = await repo.findOne({
        where: { id, merchantId: merchant.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!charge) throw new NotFoundException('Cobrança não encontrada.');
      if (charge.status !== 'pending' && charge.status !== 'detected') {
        throw new ConflictException(
          'Só é possível simular cobranças pendentes ou detectadas.',
        );
      }

      const now = new Date();
      const txHash = fakeTxHash(charge.network);
      const blockNumber = String(randomInt(5_000_000, 9_000_000));
      const changes: Partial<Charge> =
        input.outcome === 'confirmed'
          ? {
              status: 'confirmed',
              confirmations: charge.requiredConfirmations,
              receivedCryptoAmount: charge.cryptoAmount,
              detectedAt: charge.detectedAt ?? now,
              confirmedAt: now,
              txHash,
              blockNumber,
            }
          : input.outcome === 'partial'
            ? {
                status: 'partial',
                confirmations: charge.requiredConfirmations,
                receivedCryptoAmount: halfOf(
                  charge.cryptoAmount,
                  charge.network,
                ),
                detectedAt: charge.detectedAt ?? now,
                txHash,
                blockNumber,
              }
            : {
                status: 'failed',
                confirmations: 0,
                detectedAt: charge.detectedAt ?? now,
                failedAt: now,
                txHash,
              };

      await repo.update(charge.id, changes);
      await this.audit.record(
        AuditEvent.ChargeSimulated,
        meta,
        merchant.userId,
        { chargeId: charge.id, outcome: input.outcome },
        manager,
      );
    });
  }

  /**
   * Página pública de pagamento. Não exige login: quem tem o link (um UUID
   * impossível de adivinhar) pode ver a cobrança, como em qualquer gateway.
   */
  async getPublicCheckout(id: string): Promise<CheckoutResponse> {
    await this.dataSource.query(
      `UPDATE charges SET status = 'expired', updated_at = now()
        WHERE id = $1 AND status = 'pending' AND expires_at < now()`,
      [id],
    );
    const charge = await this.charges.findOne({
      where: { id },
      relations: { merchant: true },
    });
    if (!charge?.merchant)
      throw new NotFoundException('Cobrança não encontrada.');
    return toCheckoutResponse(charge, charge.merchant);
  }

  private async findOwned(merchant: Merchant, id: string): Promise<Charge> {
    const charge = await this.charges.findOneBy({
      id,
      merchantId: merchant.id,
    });
    if (!charge) throw new NotFoundException('Cobrança não encontrada.');
    return charge;
  }

  private async countByStatus(merchant: Merchant): Promise<StatusCounts> {
    const rows = await this.dataSource.query<
      Array<{ status: keyof StatusCounts; count: number }>
    >(
      'SELECT status, count(*)::int AS count FROM charges WHERE merchant_id = $1 GROUP BY status',
      [merchant.id],
    );
    const counts = emptyCounts();
    for (const row of rows) counts[row.status] = row.count;
    return counts;
  }

  /**
   * Expiração preguiçosa: sem um worker ainda (MVP 3), as cobranças vencidas
   * são marcadas como expiradas antes de cada leitura.
   */
  private async expireOverdue(merchant: Merchant): Promise<void> {
    await this.dataSource.query(
      `UPDATE charges SET status = 'expired', updated_at = now()
        WHERE merchant_id = $1 AND status = 'pending' AND expires_at < now()`,
      [merchant.id],
    );
  }
}

/** Hash no formato da rede, só para a simulação. */
function fakeTxHash(network: Charge['network']): string {
  const hex = randomBytes(32).toString('hex');
  return network === 'bitcoin-testnet' ? hex : `0x${hex}`;
}
