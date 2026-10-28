import { z } from 'zod';

export const NETWORKS = ['sepolia', 'amoy', 'bitcoin-testnet'] as const;
export const networkSchema = z.enum(NETWORKS);
export type Network = z.infer<typeof networkSchema>;

export const ASSETS = ['ETH', 'USDT', 'BTC'] as const;
export type Asset = (typeof ASSETS)[number];

export interface NetworkMeta {
  asset: Asset;
  requiredConfirmations: number;
  /** Casas decimais do valor em cripto. */
  decimals: number;
}

export const NETWORK_META: Record<Network, NetworkMeta> = {
  sepolia: { asset: 'ETH', requiredConfirmations: 12, decimals: 4 },
  amoy: { asset: 'USDT', requiredConfirmations: 30, decimals: 2 },
  'bitcoin-testnet': { asset: 'BTC', requiredConfirmations: 3, decimals: 6 },
};

export const acknowledgementSchema = z.object({ ok: z.literal(true) });
export type Acknowledgement = z.infer<typeof acknowledgementSchema>;
