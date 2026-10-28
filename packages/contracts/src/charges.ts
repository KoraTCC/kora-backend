import { z } from 'zod';
import { networkSchema, type Asset, type Network } from './networks.js';

export const CHARGE_STATUSES = [
  'pending',
  'detected',
  'confirmed',
  'partial',
  'expired',
  'failed',
] as const;
export const chargeStatusSchema = z.enum(CHARGE_STATUSES);
export type ChargeStatus = z.infer<typeof chargeStatusSchema>;

export const CHARGE_ORIGINS = ['order', 'payment-link', 'api'] as const;
export type ChargeOrigin = (typeof CHARGE_ORIGINS)[number];

export const TOLERANCES = ['0.005', '0.01', '0.02', '0'] as const;
export const EXPIRATIONS = ['15', '30', '60', '1440'] as const;

/** Corpo do POST /charges, com os nomes do formulário do front. */
export const createChargeSchema = z.object({
  amountCents: z
    .number()
    .int('Valor inválido')
    .min(100, 'Valor mínimo de R$ 1,00')
    .max(100_000_000, 'Valor acima do limite'),
  network: networkSchema,
  walletId: z.uuid('Escolha uma carteira'),
  tolerance: z.enum(TOLERANCES),
  reference: z.string().trim().min(1, 'Informe a referência do pedido').max(80),
  customerEmail: z.union([z.literal(''), z.email('E-mail inválido').max(254)]),
  description: z.string().trim().max(120, 'Use até 120 caracteres'),
  expiresInMinutes: z.enum(EXPIRATIONS),
  sendEmail: z.boolean(),
});
export type CreateChargeInput = z.infer<typeof createChargeSchema>;

export const listChargesQuerySchema = z.object({
  status: chargeStatusSchema.optional(),
  network: networkSchema.optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListChargesQuery = z.infer<typeof listChargesQuerySchema>;

export const SIMULATION_OUTCOMES = ['confirmed', 'partial', 'failed'] as const;
export const simulateChargeSchema = z.object({
  outcome: z.enum(SIMULATION_OUTCOMES),
});
export type SimulateChargeInput = z.infer<typeof simulateChargeSchema>;

export type StatusCounts = Record<ChargeStatus, number>;

export interface ChargeResponse {
  id: string;
  reference: string;
  origin: ChargeOrigin;
  customerEmail: string | null;
  description: string;
  amountCents: number;
  cryptoAmount: string;
  asset: Asset;
  network: Network;
  status: ChargeStatus;
  confirmations: number;
  requiredConfirmations: number;
  createdAt: string;
}

export interface ChargePageResponse {
  items: ChargeResponse[];
  page: number;
  pageSize: number;
  total: number;
  totalAll: number;
  counts: StatusCounts;
}

export interface ChargeStatsResponse {
  counts: StatusCounts;
  total: number;
  pendingAmountCents: number;
  confirmedDelta: number;
  receivedCents: number;
  receivedDelta: number;
  averageTicketCents: number;
  conversionRate: number;
  medianConfirmMinutes: number;
}

export interface ChargeDetailResponse extends ChargeResponse {
  address: string;
  txHash: string | null;
  blockNumber: number | null;
  receivedCryptoAmount: string | null;
  lockedRateCents: number;
  tolerance: number;
  expiresAt: string | null;
  timeline: Array<{
    id: string;
    title: string;
    at: string;
    detail: string;
    state: 'done' | 'current' | 'pending';
  }>;
  webhookAttempts: Array<{
    id: string;
    event: string;
    statusCode: number;
    latencyMs: number;
  }>;
  reconciliation: {
    rateAtCreationCents: number;
    rateAtConfirmationCents: number | null;
    networkFee: string | null;
    netAmount: string | null;
  };
}

/** O que a página pública de pagamento pode saber: sem dados do cliente. */
export interface CheckoutResponse {
  chargeId: string;
  reference: string;
  /** `partial` aparece como `detected`: o pagador ainda pode completar. */
  status: 'pending' | 'detected' | 'confirmed' | 'expired' | 'failed';
  amountCents: number;
  cryptoAmount: string;
  asset: Asset;
  network: Network;
  address: string;
  rateCents: number;
  tolerance: number;
  confirmations: number;
  requiredConfirmations: number;
  createdAt: string;
  expiresAt: string;
  detectedAt: string | null;
  txHash: string | null;
  failureReason: string | null;
  merchant: { name: string; returnUrl: string };
}
