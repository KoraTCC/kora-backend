import type { Network } from '@kora/contracts';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity.js';

/** Estabelecimento. Hoje cada usuário tem exatamente um. */
@Entity({ name: 'merchants' })
export class Merchant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Único pela relação 1:1 (restrição REL_ criada pelo TypeORM).
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'legal_name', type: 'varchar', length: 150, default: '' })
  legalName: string;

  @Column({ type: 'varchar', length: 20, default: '' })
  document: string;

  @Column({ type: 'varchar', length: 30, default: '' })
  phone: string;

  @Column({ type: 'varchar', length: 254, default: '' })
  email: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  website: string;

  @Column({ type: 'varchar', length: 10, default: 'test' })
  environment: 'test' | 'live';

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: 'active' | 'suspended';

  @Column({ name: 'display_name', type: 'varchar', length: 100 })
  displayName: string;

  @Column({ name: 'show_logo', type: 'boolean', default: true })
  showLogo: boolean;

  @Column({ name: 'show_back_button', type: 'boolean', default: true })
  showBackButton: boolean;

  @Column({ name: 'postal_code', type: 'varchar', length: 10, default: '' })
  postalCode: string;

  @Column({ type: 'varchar', length: 200, default: '' })
  street: string;

  @Column({ type: 'varchar', length: 100, default: '' })
  complement: string;

  @Column({ type: 'varchar', length: 100, default: '' })
  city: string;

  @Column({ type: 'varchar', length: 2, default: '' })
  state: string;

  @Column({ type: 'varchar', length: 2, default: 'BR' })
  country: string;

  @Column({
    name: 'enabled_networks',
    type: 'varchar',
    array: true,
    default: () => "'{sepolia,amoy,bitcoin-testnet}'",
  })
  enabledNetworks: Network[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
