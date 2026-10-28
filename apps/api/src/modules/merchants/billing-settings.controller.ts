import {
  billingSettingsSchema,
  EXPIRATIONS,
  type Acknowledgement,
  type BillingInsightsResponse,
  type BillingSettings,
} from '@kora/contracts';
import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AccessTokenGuard, CurrentUser } from '../auth/access-token.guard.js';
import type { User } from '../users/user.entity.js';
import { MerchantsService } from './merchants.service.js';

const WINDOW_LABELS: Record<(typeof EXPIRATIONS)[number], string> = {
  '15': '15 min',
  '30': '30 min',
  '60': '1 h',
  '1440': '24 h',
};

@Controller('settings/billing')
@UseGuards(AccessTokenGuard)
export class BillingSettingsController {
  constructor(
    private readonly merchants: MerchantsService,
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  async get(@CurrentUser() user: User): Promise<BillingSettings> {
    return this.merchants.billingSettings(
      await this.merchants.getOrCreateForUser(user),
    );
  }

  @Patch()
  async update(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(billingSettingsSchema)) body: BillingSettings,
  ): Promise<Acknowledgement> {
    await this.merchants.updateBillingSettings(
      await this.merchants.getOrCreateForUser(user),
      body,
    );
    return { ok: true };
  }

  /** Números das cobranças da loja que ajudam a calibrar as preferências. */
  @Get('insights')
  async insights(@CurrentUser() user: User): Promise<BillingInsightsResponse> {
    const merchant = await this.merchants.getOrCreateForUser(user);
    // Só leitura agregada; quem escreve em `charges` é o ChargesModule.
    const rows = await this.dataSource.query<
      Array<{
        window: string;
        total: number;
        expired: number;
        confirmed: number;
        partial: number;
      }>
    >(
      `SELECT round(extract(epoch FROM expires_at - created_at) / 60)::text AS window,
              count(*)::int AS total,
              count(*) FILTER (WHERE status = 'expired')::int AS expired,
              count(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
              count(*) FILTER (WHERE status = 'partial')::int AS partial
         FROM charges WHERE merchant_id = $1
        GROUP BY 1`,
      [merchant.id],
    );

    const sum = (key: 'total' | 'expired' | 'confirmed' | 'partial') =>
      rows.reduce((acc, row) => acc + row[key], 0);
    const expirationByWindow = EXPIRATIONS.map((window) => {
      const row = rows.find((r) => r.window === window);
      return { window, share: row && row.total ? row.expired / row.total : 0 };
    });

    return {
      total: sum('total'),
      withinTolerance: sum('confirmed'),
      partial: sum('partial'),
      expired: sum('expired'),
      suggestion: suggest(rows),
      expirationByWindow,
    };
  }
}

function suggest(
  rows: Array<{ window: string; total: number; expired: number }>,
): string {
  if (rows.length === 0) {
    return 'Crie algumas cobranças para ver recomendações baseadas nos seus dados.';
  }
  const worst = rows
    .filter((row) => row.total >= 3)
    .sort((a, b) => b.expired / b.total - a.expired / a.total)[0];
  if (worst && worst.expired / worst.total >= 0.3) {
    const label =
      WINDOW_LABELS[worst.window as keyof typeof WINDOW_LABELS] ??
      `${worst.window} min`;
    return `Muitas cobranças com prazo de ${label} expiram sem pagamento. Considere um prazo maior.`;
  }
  return 'Seus prazos de expiração estão funcionando bem.';
}
