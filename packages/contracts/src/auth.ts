import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Representação canônica usada pela validação, política e hash da senha. */
export function normalizePassword(password: string): string {
  return password.normalize('NFKC');
}

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('E-mail inválido').max(254, 'E-mail muito longo'));

// NIST SP 800-63B: comprimento mínimo em vez de regras de composição.
export const passwordSchema = z
  .string()
  .transform(normalizePassword)
  .pipe(
    z
      .string()
      .min(
        PASSWORD_MIN_LENGTH,
        `A senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres`,
      )
      .max(
        PASSWORD_MAX_LENGTH,
        `A senha pode ter no máximo ${PASSWORD_MAX_LENGTH} caracteres`,
      ),
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
    .transform(normalizePassword)
    .pipe(
      z
        .string()
        .min(1, 'Informe a senha')
        .max(PASSWORD_MAX_LENGTH, 'Senha inválida'),
    ),
});
export type LoginInput = z.infer<typeof loginSchema>;

export interface UserResponse {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  /** 2FA (app autenticador) ativo na conta. */
  twoFactorEnabled: boolean;
}

export interface AuthResponse {
  user: UserResponse;
}

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Link inválido').max(200, 'Link inválido'),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** Login com 2FA ativo: a senha confere, mas falta o código do app. */
export interface TwoFactorRequiredResponse {
  twoFactorRequired: true;
}
export type LoginResponse = AuthResponse | TwoFactorRequiredResponse;

export const TWO_FACTOR_CODE_LENGTH = 6;
export const RECOVERY_CODES_COUNT = 10;

/** `ABCD 2345` / `abcd2345` → `abcd-2345`. */
export function normalizeRecoveryCode(input: string): string {
  const clean = input.toLowerCase().replace(/[\s-]/g, '');
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

/**
 * Código do app autenticador (6 dígitos) **ou** código de recuperação
 * (`xxxx-xxxx`). O backend reconhece pelo formato.
 */
export const twoFactorCredentialSchema = z
  .string()
  .trim()
  .transform((value) =>
    /^\d{6}$/.test(value.replace(/\s/g, ''))
      ? value.replace(/\s/g, '')
      : normalizeRecoveryCode(value),
  )
  .pipe(
    z
      .string()
      .regex(
        /^(\d{6}|[a-z2-9]{4}-[a-z2-9]{4})$/,
        `Digite os ${TWO_FACTOR_CODE_LENGTH} dígitos do app ou um código de recuperação`,
      ),
  );

export const twoFactorCodeSchema = z.object({
  code: twoFactorCredentialSchema,
});
export type TwoFactorCodeInput = z.infer<typeof twoFactorCodeSchema>;

/** Ativar exige o código do app (não vale código de recuperação). */
export const enableTwoFactorSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, `Digite os ${TWO_FACTOR_CODE_LENGTH} dígitos do app`),
});
export type EnableTwoFactorInput = z.infer<typeof enableTwoFactorSchema>;

export const disableTwoFactorSchema = z.object({
  password: z.string().min(1, 'Informe a senha').max(PASSWORD_MAX_LENGTH),
  code: twoFactorCredentialSchema,
});
export type DisableTwoFactorInput = z.infer<typeof disableTwoFactorSchema>;

export interface TwoFactorStatusResponse {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesLeft: number;
}

export interface TwoFactorSetupResponse {
  /** Chave em base32, para digitar no app se não der para ler o QR code. */
  secret: string;
  /** Conteúdo do QR code (`otpauth://totp/...`). */
  otpauthUri: string;
}

export interface RecoveryCodesResponse {
  /** Mostrados uma única vez. */
  recoveryCodes: string[];
}
