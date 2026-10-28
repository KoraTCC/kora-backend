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

/** URL do lojista que vai receber os eventos das cobranças. */
@Entity({ name: 'webhook_endpoints' })
@Index(['merchantId', 'url'], { unique: true })
export class WebhookEndpoint {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'merchant_id', type: 'uuid' })
  merchantId: string;

  @ManyToOne(() => Merchant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'merchant_id' })
  merchant?: Merchant;

  @Column({ type: 'varchar', length: 255 })
  url: string;

  @Column({ type: 'varchar', length: 10, default: 'active' })
  status: 'active' | 'paused';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
