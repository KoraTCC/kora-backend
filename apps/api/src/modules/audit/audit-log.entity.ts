import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity.js';

export enum AuditEvent {
  Register = 'REGISTER',
  LoginSuccess = 'LOGIN_SUCCESS',
  LoginFailure = 'LOGIN_FAILURE',
  AccountLocked = 'ACCOUNT_LOCKED',
  RefreshReuse = 'REFRESH_REUSE',
  Logout = 'LOGOUT',
  PasswordResetRequested = 'PASSWORD_RESET_REQUESTED',
  PasswordResetCompleted = 'PASSWORD_RESET_COMPLETED',
  ChargeCreated = 'CHARGE_CREATED',
  ChargeSimulated = 'CHARGE_SIMULATED',
}

export type AuditMetadata = Record<string, string | number | boolean | null>;

@Entity({ name: 'audit_logs' })
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user?: User | null;

  @Column({ type: 'varchar', length: 40 })
  event: AuditEvent;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 512, nullable: true })
  userAgent: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata: AuditMetadata;

  @Index()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
