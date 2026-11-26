import { z } from 'zod';
import type { Network } from './networks.js';

export const DASHBOARD_RANGES = ['24h', '7d', '30d'] as const;
export const dashboardQuerySchema = z.object({
  range: z.enum(DASHBOARD_RANGES).default('7d'),
});
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

export type DashboardEventTone =
  'confirmed' | 'detected' | 'failed' | 'pending';

export interface DashboardOverviewResponse {
  balance: {
    /** Soma das cobranças confirmadas, em centavos. */
    availableCents: number;
    /** Confirmado desde a meia-noite (horário de Brasília). */
    todayCents: number;
  };
  volume: {
    /** Confirmado no período. */
    totalCents: number;
    /** Variação sobre o período anterior de mesmo tamanho (0.1 = +10%). */
    delta: number;
    /** Total em cripto, por ativo (ex.: "≈ 0,0184 ETH · 12,50 USDT"). */
    breakdown: string;
    /** Série do gráfico; `value` em reais. */
    points: Array<{ label: string; value: number }>;
  };
  /** Participação de cada rede no volume do período (soma 1). */
  distribution: Array<{ network: Network; share: number }>;
  integration: Array<{ id: string; label: string; isDone: boolean }>;
  events: Array<{
    id: string;
    tone: DashboardEventTone;
    title: string;
    detail: string;
    at: string;
  }>;
}
