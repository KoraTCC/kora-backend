import type { MerchantResponse } from '@kora/contracts';
import type { Merchant } from './merchant.entity.js';

/** Limites do plano de demonstração (ainda não há cobrança de assinatura). */
const PLAN = {
  name: 'Starter',
  chargesLimit: 1_000,
  apiCallsLimit: 50_000,
  webhookEndpointsLimit: 3,
};

function formatDocument(digits: string): string {
  if (digits.length !== 14) return digits;
  return digits.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    '$1.$2.$3/$4-$5',
  );
}

function formatPostalCode(digits: string): string {
  return digits.length === 8
    ? `${digits.slice(0, 5)}-${digits.slice(5)}`
    : digits;
}

export function toMerchantResponse(
  merchant: Merchant,
  usage: { chargesUsed: number },
): MerchantResponse {
  const renewsAt = new Date(merchant.createdAt);
  renewsAt.setMonth(renewsAt.getMonth() + 1);
  while (renewsAt.getTime() < Date.now())
    renewsAt.setMonth(renewsAt.getMonth() + 1);

  return {
    id: merchant.id,
    name: merchant.name,
    legalName: merchant.legalName,
    document: formatDocument(merchant.document),
    phone: merchant.phone,
    email: merchant.email,
    website: merchant.website,
    createdAt: merchant.createdAt.toISOString(),
    environment: merchant.environment,
    status: merchant.status,
    checkout: {
      displayName: merchant.displayName,
      showLogo: merchant.showLogo,
      showBackButton: merchant.showBackButton,
    },
    address: {
      postalCode: formatPostalCode(merchant.postalCode),
      street: merchant.street,
      complement: merchant.complement,
      city: merchant.city,
      state: merchant.state,
      country: merchant.country,
    },
    plan: {
      name: PLAN.name,
      renewsAt: renewsAt.toISOString(),
      chargesUsed: usage.chargesUsed,
      chargesLimit: PLAN.chargesLimit,
      apiCallsUsed: 0,
      apiCallsLimit: PLAN.apiCallsLimit,
      webhookEndpointsUsed: 0,
      webhookEndpointsLimit: PLAN.webhookEndpointsLimit,
    },
  };
}
