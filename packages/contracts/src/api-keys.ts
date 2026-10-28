import { z } from 'zod';

export const API_SECRET_KEYS_LIMIT = 5;

/** Hoje só existem chaves secretas de teste (o ambiente live ainda é bloqueado). */
export const createApiKeySchema = z.object({
  kind: z.literal('secret'),
  environment: z.literal('test'),
});
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

export interface ApiKeyResponse {
  id: string;
  /** `sk_test_91be…59d0`: a chave inteira nunca volta depois de criada. */
  maskedKey: string;
  kind: 'publishable' | 'secret';
  createdAt: string;
  lastUsedAt: string | null;
  callsLast7d: number;
}

export interface TestCredentialsResponse {
  /** Chave publicável: é pública, pode voltar inteira. */
  publishableKey: string;
  /** Chave secreta mais recente, MASCARADA (ou '' se não houver). */
  secretKey: string;
}

export interface CreatedApiKeyResponse {
  /** Única vez em que a chave secreta aparece inteira. */
  secretKey: string;
}
