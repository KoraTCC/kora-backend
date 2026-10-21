import type { UserResponse } from '@kora/contracts';
import type { User } from './user.entity.js';

/** Única forma de expor um usuário na API: nunca vaza hash ou contadores. */
export function toUserResponse(user: User): UserResponse {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt.toISOString(),
  };
}
