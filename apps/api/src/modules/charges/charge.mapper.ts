import type {
  ChargeDetailResponse,
  ChargeResponse,
  CheckoutResponse,
} from '@kora/contracts';
import type { Merchant } from '../merchants/merchant.entity.js';
import type { Charge } from './charge.entity.js';
import { toNetworkDecimals } from './quote.js';

export function toChargeResponse(charge: Charge): ChargeResponse {
  return {
    id: charge.id,
    reference: charge.reference,
    origin: charge.origin,
    customerEmail: charge.customerEmail,
    description: charge.description,
    amountCents: charge.amountCents,
    cryptoAmount: toNetworkDecimals(charge.cryptoAmount, charge.network),
    asset: charge.asset,
    network: charge.network,
    status: charge.status,
    confirmations: charge.confirmations,
    requiredConfirmations: charge.requiredConfirmations,
    createdAt: charge.createdAt.toISOString(),
  };
}

export function toChargeDetailResponse(charge: Charge): ChargeDetailResponse {
  const lockedRateCents = Number(charge.lockedRateCents);
  const received = charge.receivedCryptoAmount
    ? toNetworkDecimals(charge.receivedCryptoAmount, charge.network)
    : null;
  return {
    ...toChargeResponse(charge),
    address: charge.address,
    txHash: charge.txHash,
    blockNumber:
      charge.blockNumber === null ? null : Number(charge.blockNumber),
    receivedCryptoAmount: received,
    lockedRateCents,
    tolerance: Number(charge.tolerance),
    expiresAt: charge.expiresAt.toISOString(),
    timeline: buildTimeline(charge),
    // Entrega de webhooks ainda não existe (MVP 3 da arquitetura).
    webhookAttempts: [],
    reconciliation: {
      rateAtCreationCents: lockedRateCents,
      rateAtConfirmationCents: charge.confirmedAt ? lockedRateCents : null,
      networkFee: null,
      netAmount: charge.status === 'confirmed' ? received : null,
    },
  };
}

type TimelineEvent = ChargeDetailResponse['timeline'][number];

function buildTimeline(charge: Charge): TimelineEvent[] {
  const iso = (date: Date) => date.toISOString();
  const events: TimelineEvent[] = [
    {
      id: 'created',
      title: 'Cobrança criada',
      at: iso(charge.createdAt),
      detail: `Cotação travada para ${charge.asset}`,
      state: 'done',
    },
  ];

  switch (charge.status) {
    case 'pending':
      events.push({
        id: 'awaiting',
        title: 'Aguardando pagamento',
        at: iso(charge.expiresAt),
        detail: 'Expira se nenhum pagamento for detectado até este horário',
        state: 'current',
      });
      break;
    case 'expired':
      events.push({
        id: 'expired',
        title: 'Cobrança expirada',
        at: iso(charge.expiresAt),
        detail: 'Nenhum pagamento detectado no prazo',
        state: 'done',
      });
      break;
    case 'failed':
      events.push({
        id: 'failed',
        title: 'Pagamento falhou',
        at: iso(charge.failedAt ?? charge.updatedAt),
        detail: 'A transação foi revertida na rede',
        state: 'done',
      });
      break;
    default: {
      events.push({
        id: 'detected',
        title: 'Pagamento detectado',
        at: iso(charge.detectedAt ?? charge.updatedAt),
        detail: charge.txHash ? `Transação ${charge.txHash.slice(0, 10)}…` : '',
        state: 'done',
      });
      if (charge.status === 'confirmed') {
        events.push({
          id: 'confirmed',
          title: 'Pagamento confirmado',
          at: iso(charge.confirmedAt ?? charge.updatedAt),
          detail: `${charge.requiredConfirmations} confirmações na rede`,
          state: 'done',
        });
      } else if (charge.status === 'partial') {
        events.push({
          id: 'partial',
          title: 'Pagamento parcial',
          at: iso(charge.updatedAt),
          detail: 'Valor recebido abaixo da tolerância',
          state: 'current',
        });
      } else {
        events.push({
          id: 'confirming',
          title: 'Aguardando confirmações',
          at: iso(charge.updatedAt),
          detail: `${charge.confirmations}/${charge.requiredConfirmations} confirmações`,
          state: 'current',
        });
      }
    }
  }
  return events;
}

/** Versão pública: nada de e-mail do cliente, descrição ou dados internos. */
export function toCheckoutResponse(
  charge: Charge,
  merchant: Merchant,
): CheckoutResponse {
  return {
    chargeId: charge.id,
    reference: charge.reference,
    status: charge.status === 'partial' ? 'detected' : charge.status,
    amountCents: charge.amountCents,
    cryptoAmount: toNetworkDecimals(charge.cryptoAmount, charge.network),
    asset: charge.asset,
    network: charge.network,
    address: charge.address,
    rateCents: Number(charge.lockedRateCents),
    tolerance: Number(charge.tolerance),
    confirmations: charge.confirmations,
    requiredConfirmations: charge.requiredConfirmations,
    createdAt: charge.createdAt.toISOString(),
    expiresAt: charge.expiresAt.toISOString(),
    detectedAt: charge.detectedAt?.toISOString() ?? null,
    txHash: charge.txHash,
    failureReason:
      charge.status === 'failed' ? 'A transação foi revertida na rede.' : null,
    merchant: {
      name: merchant.displayName,
      returnUrl: merchant.website,
    },
  };
}
