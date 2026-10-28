import { z } from 'zod';
import { EXPIRATIONS, TOLERANCES } from './charges.js';
import { networkSchema } from './networks.js';

/** Preferências de cobrança da loja (Configurações → Cobrança). */
export const billingSettingsSchema = z.object({
  defaultTolerance: z.enum(TOLERANCES),
  defaultWindowMinutes: z.enum(EXPIRATIONS),
  referenceCurrency: z.enum(['BRL', 'USD', 'EUR']),
  defaultNetwork: networkSchema,
  acceptOverpayment: z.boolean(),
  autoExpire: z.boolean(),
  sendReceipt: z.boolean(),
  notifyDetected: z.boolean(),
  remindBeforeExpiry: z.boolean(),
  senderEmail: z.string().trim().min(3, 'Informe o remetente').max(254),
  returnUrl: z.url('URL inválida').max(255),
});
export type BillingSettings = z.infer<typeof billingSettingsSchema>;

export interface BillingInsightsResponse {
  total: number;
  withinTolerance: number;
  partial: number;
  expired: number;
  suggestion: string;
  expirationByWindow: Array<{
    window: (typeof EXPIRATIONS)[number];
    share: number;
  }>;
}
