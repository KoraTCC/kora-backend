import { AuditLog } from '../modules/audit/audit-log.entity.js';
import { RefreshToken } from '../modules/auth/refresh-token.entity.js';
import { User } from '../modules/users/user.entity.js';

// Registro explícito das entidades (ESM não combina com globs de arquivos).
export const entities = [User, RefreshToken, AuditLog];
