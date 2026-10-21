import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('E-mail inválido').max(254, 'E-mail muito longo'));

// NIST SP 800-63B: comprimento mínimo em vez de regras de composição.
export const passwordSchema = z
  .string()
  .min(
    PASSWORD_MIN_LENGTH,
    `A senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres`,
  )
  .max(
    PASSWORD_MAX_LENGTH,
    `A senha pode ter no máximo ${PASSWORD_MAX_LENGTH} caracteres`,
  );

export const nameSchema = z
  .string()
  .trim()
  .min(2, 'Nome muito curto')
  .max(100, 'Nome muito longo');

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

// No login a senha não passa pela política: só limita o tamanho.
export const loginSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(1, 'Informe a senha')
    .max(PASSWORD_MAX_LENGTH, 'Senha inválida'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export interface UserResponse {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface AuthResponse {
  user: UserResponse;
}
