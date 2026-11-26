import { ApiKey } from './api-key.entity.js';
import { AuditLog } from './audit-log.entity.js';
import { PasswordResetToken } from './password-reset-token.entity.js';
import { RecoveryCode } from './recovery-code.entity.js';
import { RefreshToken } from './refresh-token.entity.js';
import { Charge } from './charge.entity.js';
import { Merchant } from './merchant.entity.js';
import { User } from './user.entity.js';
import { Wallet } from './wallet.entity.js';

// Registro explícito das entidades (ESM não combina com globs de arquivos).
export const entities = [
  User,
  PasswordResetToken,
  RefreshToken,
  AuditLog,
  Merchant,
  Wallet,
  Charge,
  ApiKey,
  RecoveryCode,
];
