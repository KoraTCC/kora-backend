import { z } from 'zod';
import { networkSchema, type Network } from './networks.js';

export const addWalletSchema = z.object({
  address: z
    .string()
    .trim()
    .min(26, 'Endereço muito curto')
    .max(90, 'Endereço muito longo')
    .regex(/^[A-Za-z0-9]+$/, 'Endereço inválido'),
  network: networkSchema,
});
export type AddWalletInput = z.infer<typeof addWalletSchema>;

export const updateNetworkSettingsSchema = z.object({
  enabledNetworks: z
    .array(networkSchema)
    .min(1, 'Deixe ao menos uma rede ativa'),
});
export type UpdateNetworkSettingsInput = z.infer<
  typeof updateNetworkSettingsSchema
>;

export interface WalletResponse {
  id: string;
  address: string;
  network: Network;
  status: 'default' | 'active' | 'verifying';
  settledCount: number;
  settledLast7dCents: number;
}

export interface NetworkSettingResponse {
  network: Network;
  isEnabled: boolean;
}
