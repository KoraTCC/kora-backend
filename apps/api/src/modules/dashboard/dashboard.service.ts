import {
  NETWORK_META,
  type Asset,
  type ChargeStatus,
  type DashboardEventTone,
  type DashboardOverviewResponse,
  type DashboardRange,
  type Network,
} from '@kora/contracts';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { Merchant } from '@kora/database';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Os textos e o "hoje" seguem o horário de Brasília. */
const TIME_ZONE = 'America/Sao_Paulo';

/** Tamanho do período e de cada ponto do gráfico. */
const RANGES: Record<DashboardRange, { spanMs: number; buckets: number }> = {
  '24h': { spanMs: DAY_MS, buckets: 8 }, // de 3 em 3 horas
  '7d': { spanMs: 7 * DAY_MS, buckets: 7 }, // por dia
  '30d': { spanMs: 30 * DAY_MS, buckets: 10 }, // de 3 em 3 dias
};

const ASSET_DECIMALS: Record<Asset, number> = Object.fromEntries(
  Object.values(NETWORK_META).map((meta) => [meta.asset, meta.decimals]),
) as Record<Asset, number>;

const RECENT_EVENTS = 6;

function delta(current: number, previous: number): number {
  return previous === 0 ? 0 : (current - previous) / previous;
}

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

function bucketLabel(end: Date, range: DashboardRange): string {
  if (range === '24h') {
    const hour = new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      hourCycle: 'h23',
      timeZone: TIME_ZONE,
    }).format(end);
    return `${hour}h`;
  }
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    timeZone: TIME_ZONE,
  })
    .format(end)
    .replace('.', '');
}

function shortAddress(address: string): string {
  return address.length > 12
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address;
}

interface EventRow {
  id: string;
  reference: string;
  status: ChargeStatus;
  amount_cents: number;
  address: string;
  confirmations: number;
  created_at: Date;
  updated_at: Date;
}

function toEvent(row: EventRow): DashboardOverviewResponse['events'][number] {
  const ref = row.reference;
  const at = row.updated_at.toISOString();
  const event = (tone: DashboardEventTone, title: string, detail: string) => ({
    id: `${row.id}:${row.status}`,
    tone,
    title,
    detail,
    at,
  });
  switch (row.status) {
    case 'confirmed':
      return event(
        'confirmed',
        `Cobrança ${ref} confirmada`,
        `${row.confirmations} confirmações`,
      );
    case 'detected':
      return event(
        'detected',
        `Pagamento detectado em ${ref}`,
        shortAddress(row.address),
      );
    case 'partial':
      return event(
        'failed',
        `Pagamento parcial em ${ref}`,
        'Precisa de revisão',
      );
    case 'expired':
      return event('failed', `Cobrança ${ref} expirou`, 'Sem pagamento');
    case 'failed':
      return event('failed', `Cobrança ${ref} falhou`, 'Pagamento recusado');
    case 'pending':
      return event(
        'pending',
        `Cobrança ${ref} criada`,
        brl.format(row.amount_cents / 100),
      );
  }
}

/**
 * Números do painel calculados das cobranças. Não há saldo on-chain ainda:
 * o "saldo" é a soma do que foi confirmado.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly dataSource: DataSource) {}

  async overview(
    merchant: Merchant,
    range: DashboardRange,
  ): Promise<DashboardOverviewResponse> {
    const now = new Date();
    const [balance, volume, distribution, integration, events] =
      await Promise.all([
        this.balance(merchant.id),
        this.volume(merchant.id, range, now),
        this.distribution(merchant.id, range, now),
        this.integration(merchant.id),
        this.events(merchant.id),
      ]);
    return { balance, volume, distribution, integration, events };
  }

  private async balance(
    merchantId: string,
  ): Promise<DashboardOverviewResponse['balance']> {
    const [row] = await this.dataSource.query<
      Array<{ total: string; today: string }>
    >(
      `SELECT
         coalesce(sum(amount_cents), 0) AS total,
         coalesce(sum(amount_cents) FILTER (WHERE confirmed_at >=
           date_trunc('day', now() AT TIME ZONE $2) AT TIME ZONE $2), 0) AS today
       FROM charges WHERE merchant_id = $1 AND status = 'confirmed'`,
      [merchantId, TIME_ZONE],
    );
    return {
      availableCents: Number(row?.total ?? 0),
      todayCents: Number(row?.today ?? 0),
    };
  }

  private async volume(
    merchantId: string,
    range: DashboardRange,
    now: Date,
  ): Promise<DashboardOverviewResponse['volume']> {
    const { spanMs, buckets } = RANGES[range];
    const bucketMs = spanMs / buckets;
    const start = new Date(now.getTime() - spanMs);
    const previousStart = new Date(start.getTime() - spanMs);

    const [totals, series, assets] = await Promise.all([
      this.dataSource.query<Array<{ current: string; previous: string }>>(
        `SELECT
           coalesce(sum(amount_cents) FILTER (WHERE confirmed_at > $2), 0) AS current,
           coalesce(sum(amount_cents) FILTER (WHERE confirmed_at <= $2), 0) AS previous
         FROM charges
         WHERE merchant_id = $1 AND status = 'confirmed'
           AND confirmed_at > $3 AND confirmed_at <= $4`,
        [merchantId, start, previousStart, now],
      ),
      // Índice do ponto: 0 = mais antigo; a última fatia termina em `now`.
      this.dataSource.query<Array<{ bucket: number; cents: string }>>(
        `SELECT least(floor(extract(epoch FROM confirmed_at - $2::timestamptz) * 1000 / $3)::int, $4 - 1) AS bucket,
                sum(amount_cents) AS cents
           FROM charges
          WHERE merchant_id = $1 AND status = 'confirmed'
            AND confirmed_at > $2 AND confirmed_at <= $5
          GROUP BY 1`,
        [merchantId, start, bucketMs, buckets, now],
      ),
      this.dataSource.query<Array<{ asset: Asset; amount: string }>>(
        `SELECT asset, sum(crypto_amount) AS amount
           FROM charges
          WHERE merchant_id = $1 AND status = 'confirmed'
            AND confirmed_at > $2 AND confirmed_at <= $3
          GROUP BY asset ORDER BY sum(amount_cents) DESC`,
        [merchantId, start, now],
      ),
    ]);

    const byBucket = new Map(
      series.map((row) => [Number(row.bucket), Number(row.cents)]),
    );
    const points = Array.from({ length: buckets }, (_, index) => ({
      label: bucketLabel(
        new Date(start.getTime() + (index + 1) * bucketMs),
        range,
      ),
      value: (byBucket.get(index) ?? 0) / 100,
    }));

    const breakdown = assets.length
      ? `≈ ${assets
          .map(
            ({ asset, amount }) =>
              `${new Intl.NumberFormat('pt-BR', {
                maximumFractionDigits: ASSET_DECIMALS[asset],
              }).format(Number(amount))} ${asset}`,
          )
          .join(' · ')}`
      : 'Nenhum recebimento no período';

    const current = Number(totals[0]?.current ?? 0);
    const previous = Number(totals[0]?.previous ?? 0);
    return {
      totalCents: current,
      delta: delta(current, previous),
      breakdown,
      points,
    };
  }

  private async distribution(
    merchantId: string,
    range: DashboardRange,
    now: Date,
  ): Promise<DashboardOverviewResponse['distribution']> {
    const start = new Date(now.getTime() - RANGES[range].spanMs);
    const rows = await this.dataSource.query<
      Array<{ network: Network; cents: string }>
    >(
      `SELECT network, sum(amount_cents) AS cents
         FROM charges
        WHERE merchant_id = $1 AND status = 'confirmed'
          AND confirmed_at > $2 AND confirmed_at <= $3
        GROUP BY network ORDER BY 2 DESC`,
      [merchantId, start, now],
    );
    const total = rows.reduce((sum, row) => sum + Number(row.cents), 0);
    return total === 0
      ? []
      : rows.map((row) => ({
          network: row.network,
          share: Number(row.cents) / total,
        }));
  }

  private async integration(
    merchantId: string,
  ): Promise<DashboardOverviewResponse['integration']> {
    const [row] = await this.dataSource.query<
      Array<{ api_key: boolean; wallet: boolean; test: boolean }>
    >(
      `SELECT
         EXISTS (SELECT 1 FROM api_keys WHERE merchant_id = $1
                  AND kind = 'secret' AND revoked_at IS NULL) AS api_key,
         EXISTS (SELECT 1 FROM wallets WHERE merchant_id = $1) AS wallet,
         EXISTS (SELECT 1 FROM charges WHERE merchant_id = $1
                  AND status = 'confirmed') AS test`,
      [merchantId],
    );
    return [
      { id: 'api-key', label: 'Gerar chave de API', isDone: !!row?.api_key },
      {
        id: 'wallet',
        label: 'Cadastrar carteira de recebimento',
        isDone: !!row?.wallet,
      },
      // Webhooks ainda não existem no backend.
      { id: 'webhook', label: 'Configurar endpoint de webhook', isDone: false },
      { id: 'test', label: 'Fazer uma cobrança de teste', isDone: !!row?.test },
    ];
  }

  /** Última mudança de cada cobrança, da mais recente para a mais antiga. */
  private async events(
    merchantId: string,
  ): Promise<DashboardOverviewResponse['events']> {
    const rows = await this.dataSource.query<EventRow[]>(
      `SELECT id, reference, status, amount_cents, address, confirmations,
              created_at, updated_at
         FROM charges WHERE merchant_id = $1
        ORDER BY updated_at DESC LIMIT $2`,
      [merchantId, RECENT_EVENTS],
    );
    return rows.map(toEvent);
  }
}
