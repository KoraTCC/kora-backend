import { z } from 'zod';

export const WEBHOOK_EVENTS = [
  'charge.created',
  'charge.detected',
  'charge.confirmed',
  'charge.partial',
  'charge.expired',
  'charge.failed',
] as const;
export const webhookEventSchema = z.enum(WEBHOOK_EVENTS);
export type WebhookEvent = z.infer<typeof webhookEventSchema>;

export const WEBHOOK_ENDPOINTS_LIMIT = 3;

export const createWebhookEndpointSchema = z.object({
  url: z
    .url('Informe uma URL https válida')
    .max(255, 'URL muito longa')
    .startsWith('https://', 'Use https://'),
});
export type CreateWebhookEndpointInput = z.infer<
  typeof createWebhookEndpointSchema
>;

export const updateWebhookEndpointSchema = z.object({
  status: z.enum(['active', 'paused']),
});
export type UpdateWebhookEndpointInput = z.infer<
  typeof updateWebhookEndpointSchema
>;

export const updateWebhookSubscriptionSchema = z.object({
  events: z.array(webhookEventSchema),
});
export type UpdateWebhookSubscriptionInput = z.infer<
  typeof updateWebhookSubscriptionSchema
>;

export interface WebhookEndpointResponse {
  id: string;
  url: string;
  status: 'active' | 'failing' | 'paused';
  events: WebhookEvent[];
  lastDeliveryAt: string | null;
  consecutiveFailures: number;
  nextRetryAt: string | null;
}

export interface WebhookSubscriptionItem {
  event: WebhookEvent;
  isEnabled: boolean;
}

export interface WebhookSecretResponse {
  secret: string;
  algorithm: string;
}

export interface WebhookStatsResponse {
  delivered: number;
  successRate: number;
  successTarget: number;
  failing: number;
  retryingEndpoints: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
}
