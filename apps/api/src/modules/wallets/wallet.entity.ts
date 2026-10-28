import type { Network } from '@kora/contracts';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Merchant } from '../merchants/merchant.entity.js';

/** Endereço que recebe os pagamentos de um merchant numa rede. */
@Entity({ name: 'wallets' })
@Index(['merchantId', 'network', 'address'], { unique: true })
export class Wallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'merchant_id', type: 'uuid' })
  merchantId: string;

  @ManyToOne(() => Merchant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'merchant_id' })
  merchant?: Merchant;

  @Column({ type: 'varchar', length: 90 })
  address: string;

  @Column({ type: 'varchar', length: 30 })
  network: Network;

  /** Carteira usada por padrão nas cobranças desta rede. */
  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
