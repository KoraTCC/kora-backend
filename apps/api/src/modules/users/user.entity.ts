import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** Sempre em minúsculas (normalizado na entrada). */
  @Column({ type: 'varchar', length: 254, unique: true })
  email: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash: string;

  /** Tokens de acesso emitidos antes deste instante são rejeitados. */
  @Column({ name: 'password_changed_at', type: 'timestamptz' })
  passwordChangedAt: Date;

  @Column({ name: 'failed_login_count', type: 'int', default: 0 })
  failedLoginCount: number;

  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true })
  lockedUntil: Date | null;

  /** Segredo TOTP ativo, cifrado com AES-256-GCM (`SecretBox`). */
  @Column({ name: 'two_factor_secret', type: 'text', nullable: true })
  twoFactorSecret: string | null;

  /** Segredo gerado na configuração, antes de confirmar o primeiro código. */
  @Column({ name: 'two_factor_pending_secret', type: 'text', nullable: true })
  twoFactorPendingSecret: string | null;

  @Column({
    name: 'two_factor_enabled_at',
    type: 'timestamptz',
    nullable: true,
  })
  twoFactorEnabledAt: Date | null;

  /** Último período TOTP aceito: o mesmo código não vale duas vezes. */
  @Column({ name: 'two_factor_last_step', type: 'bigint', nullable: true })
  twoFactorLastStep: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
