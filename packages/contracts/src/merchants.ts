import { z } from 'zod';

/** Corpo do PATCH /merchants/me: plano, com os mesmos nomes do formulário do front. */
export const updateMerchantProfileSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome da loja').max(100),
  legalName: z.string().trim().min(2, 'Informe a razão social').max(150),
  document: z
    .string()
    .trim()
    .regex(/^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/, 'CNPJ inválido'),
  phone: z.string().trim().min(8, 'Telefone inválido').max(30),
  email: z.email('E-mail inválido').max(254),
  website: z.url('URL inválida').max(255),
  displayName: z.string().trim().min(2, 'Informe o nome exibido').max(100),
  showLogo: z.boolean(),
  showBackButton: z.boolean(),
  postalCode: z.string().trim().min(8, 'CEP inválido').max(10),
  street: z.string().trim().min(2, 'Informe o logradouro').max(200),
  complement: z.string().trim().max(100),
  city: z.string().trim().min(2, 'Informe a cidade').max(100),
  state: z.string().trim().length(2, 'UF inválida'),
  country: z.string().trim().min(2).max(2),
});
export type UpdateMerchantProfileInput = z.infer<
  typeof updateMerchantProfileSchema
>;

export interface MerchantResponse {
  id: string;
  name: string;
  legalName: string;
  document: string;
  phone: string;
  email: string;
  website: string;
  createdAt: string;
  environment: 'test' | 'live';
  status: 'active' | 'suspended';
  checkout: { displayName: string; showLogo: boolean; showBackButton: boolean };
  address: {
    postalCode: string;
    street: string;
    complement: string;
    city: string;
    state: string;
    country: string;
  };
  plan: {
    name: string;
    renewsAt: string;
    chargesUsed: number;
    chargesLimit: number;
    apiCallsUsed: number;
    apiCallsLimit: number;
    webhookEndpointsUsed: number;
    webhookEndpointsLimit: number;
  };
}
