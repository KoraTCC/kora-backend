import { AuditLog } from '../modules/audit/audit-log.entity.js';
import { PasswordResetToken } from '../modules/auth/password-reset-token.entity.js';
import { RefreshToken } from '../modules/auth/refresh-token.entity.js';
import { Charge } from '../modules/charges/charge.entity.js';
import { Merchant } from '../modules/merchants/merchant.entity.js';
import { User } from '../modules/users/user.entity.js';
import { Wallet } from '../modules/wallets/wallet.entity.js';

// Registro explícito das entidades (ESM não combina com globs de arquivos).
export const entities = [
  User,
  PasswordResetToken,
  RefreshToken,
  AuditLog,
  Merchant,
  Wallet,
  Charge,
];
