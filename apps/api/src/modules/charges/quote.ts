import { NETWORK_META, type Network } from '@kora/contracts';

/**
 * Preço de 1 unidade de cada ativo em centavos de BRL. Cotação FIXA de
 * demonstração (a mesma do frontend); um provedor de preços real entra
 * junto com a integração on-chain.
 */
export const DEMO_RATES_CENTS: Record<Network, number> = {
  sepolia: 1_353_260,
  amoy: 542,
  'bitcoin-testnet': 35_200_000,
};

/**
 * Converte centavos de BRL no valor em cripto, com as casas da rede.
 * Usa BigInt e arredonda PARA CIMA: o cliente nunca paga menos que o valor.
 *   quoteCryptoAmount(24_900, 'sepolia') === '0.0185'
 */
export function quoteCryptoAmount(
  amountCents: number,
  network: Network,
): string {
  const { decimals } = NETWORK_META[network];
  const scale = 10n ** BigInt(decimals);
  const rate = BigInt(DEMO_RATES_CENTS[network]);
  const numerator = BigInt(amountCents) * scale;
  const units = (numerator + rate - 1n) / rate; // divisão com teto
  return formatUnits(units, decimals);
}

/** `1840n, 4` → `'0.1840'`. */
export function formatUnits(units: bigint, decimals: number): string {
  const digits = units.toString().padStart(decimals + 1, '0');
  if (decimals === 0) return digits;
  return `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}

/** Ajusta um decimal vindo do Postgres (`'0.01840000'`) às casas da rede. */
export function toNetworkDecimals(value: string, network: Network): string {
  const { decimals } = NETWORK_META[network];
  const [int = '0', frac = ''] = value.split('.');
  if (decimals === 0) return int;
  return `${int}.${frac.padEnd(decimals, '0').slice(0, decimals)}`;
}

/** Metade de um valor decimal, para simular pagamento parcial. */
export function halfOf(value: string, network: Network): string {
  const { decimals } = NETWORK_META[network];
  const [int = '0', frac = ''] = toNetworkDecimals(value, network).split('.');
  const units = BigInt(int + frac.padEnd(decimals, '0'));
  return formatUnits(units / 2n, decimals);
}
