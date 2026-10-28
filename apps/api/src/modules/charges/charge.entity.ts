import type {
  Asset,
  ChargeOrigin,
  ChargeStatus,
  Network,
} from '@kora/contracts';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Merchant } from '../merchants/merchant.entity.js';
import { Wallet } from '../wallets/wallet.entity.js';

@Entity({ name: 'charges' })
@Index(['merchantId', 'createdAt'])
@Index(['merchantId', 'status'])
export class Charge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'merchant_id', type: 'uuid' })
  merchantId: string;

  @ManyToOne(() => Merchant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'merchant_id' })
  merchant?: Merchant;

  /** RESTRICT: carteira que já recebeu cobrança não pode ser apagada. */
  @Index()
  @Column({ name: 'wallet_id', type: 'uuid' })
  walletId: string;

  @ManyToOne(() => Wallet, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'wallet_id' })
  wallet?: Wallet;

  @Column({ type: 'varchar', length: 80 })
  reference: string;

  @Column({ type: 'varchar', length: 20 })
  origin: ChargeOrigin;

  @Column({
    name: 'customer_email',
    type: 'varchar',
    length: 254,
    nullable: true,
  })
  customerEmail: string | null;

  @Column({ type: 'varchar', length: 120, default: '' })
  description: string;

  /** BRL em centavos: inteiro, nunca ponto flutuante. */
  @Column({ name: 'amount_cents', type: 'integer' })
  amountCents: number;

  /** Valor em cripto travado na criação. `numeric` → string no Node. */
  @Column({ name: 'crypto_amount', type: 'numeric', precision: 30, scale: 8 })
  cryptoAmount: string;

  @Column({ type: 'varchar', length: 10 })
  asset: Asset;

  @Column({ type: 'varchar', length: 30 })
  network: Network;

  /** Cópia do endereço: a cobrança não muda se a carteira mudar. */
  @Column({ type: 'varchar', length: 90 })
  address: string;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: ChargeStatus;

  @Column({ type: 'integer', default: 0 })
  confirmations: number;

  @Column({ name: 'required_confirmations', type: 'integer' })
  requiredConfirmations: number;

  @Column({ type: 'numeric', precision: 6, scale: 4, default: 0 })
  tolerance: string;

  @Column({ name: 'locked_rate_cents', type: 'bigint' })
  lockedRateCents: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'tx_hash', type: 'varchar', length: 100, nullable: true })
  txHash: string | null;

  @Column({ name: 'block_number', type: 'bigint', nullable: true })
  blockNumber: string | null;

  @Column({
    name: 'received_crypto_amount',
    type: 'numeric',
    precision: 30,
    scale: 8,
    nullable: true,
  })
  receivedCryptoAmount: string | null;

  @Column({ name: 'detected_at', type: 'timestamptz', nullable: true })
  detectedAt: Date | null;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;

  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
