import { CreateUsersAndAuth1792605639151 } from './1792605639151-CreateUsersAndAuth.js';
import { CreateMerchantsWalletsCharges1793189692584 } from './1793189692584-CreateMerchantsWalletsCharges.js';
import { CreatePasswordResetTokens1793190854375 } from './1793190854375-CreatePasswordResetTokens.js';
import { CreateWebhookEndpoints1793194643264 } from './1793194643264-CreateWebhookEndpoints.js';

// Registro explícito das migrations, em ordem de criação.
export const migrations = [
  CreateUsersAndAuth1792605639151,
  CreateMerchantsWalletsCharges1793189692584,
  CreatePasswordResetTokens1793190854375,
  CreateWebhookEndpoints1793194643264,
];
