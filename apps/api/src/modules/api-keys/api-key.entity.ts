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

@Entity({ name: 'api_keys' })
export class ApiKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'merchant_id', type: 'uuid' })
  merchantId: string;

  @ManyToOne(() => Merchant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'merchant_id' })
  merchant?: Merchant;

  @Column({ type: 'varchar', length: 15 })
  kind: 'publishable' | 'secret';

  @Column({ type: 'varchar', length: 10, default: 'test' })
  environment: 'test' | 'live';

  /** Começo e fim da chave, só para exibir mascarada (`sk_test_91be…59d0`). */
  @Column({ type: 'varchar', length: 16 })
  prefix: string;

  @Column({ type: 'varchar', length: 4 })
  last4: string;

  /** Chave secreta: só o SHA-256, como os refresh tokens. */
  @Index({ unique: true })
  @Column({ name: 'key_hash', type: 'char', length: 64, nullable: true })
  keyHash: string | null;

  /** Chave publicável: é pública por definição, fica inteira. */
  @Column({ name: 'public_key', type: 'varchar', length: 64, nullable: true })
  publicKey: string | null;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
