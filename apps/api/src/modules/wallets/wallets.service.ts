import {
  NETWORKS,
  type AddWalletInput,
  type NetworkSettingResponse,
  type WalletResponse,
} from '@kora/contracts';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, type Repository } from 'typeorm';
import type { Merchant } from '../merchants/merchant.entity.js';
import { Wallet } from './wallet.entity.js';

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

@Injectable()
export class WalletsService {
  constructor(
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    private readonly dataSource: DataSource,
  ) {}

  /** Carteiras do merchant com o total liquidado (cobranças confirmadas). */
  async list(merchant: Merchant): Promise<WalletResponse[]> {
    const rows = await this.dataSource.query<
      Array<{
        id: string;
        address: string;
        network: WalletResponse['network'];
        is_default: boolean;
        settled_count: number;
        settled_last_7d_cents: number;
      }>
    >(
      `SELECT w.id, w.address, w.network, w.is_default,
              count(c.id)::int AS settled_count,
              coalesce(sum(c.amount_cents) FILTER (
                WHERE c.confirmed_at > now() - interval '7 days'), 0)::int
                AS settled_last_7d_cents
         FROM wallets w
         LEFT JOIN charges c ON c.wallet_id = w.id AND c.status = 'confirmed'
        WHERE w.merchant_id = $1
        GROUP BY w.id
        ORDER BY w.network, w.is_default DESC, w.created_at`,
      [merchant.id],
    );
    return rows.map((row) => ({
      id: row.id,
      address: row.address,
      network: row.network,
      status: row.is_default ? 'default' : 'active',
      settledCount: row.settled_count,
      settledLast7dCents: row.settled_last_7d_cents,
    }));
  }

  /** Carteira do merchant, ou 404 (também quando é de outro merchant). */
  async findOwned(merchant: Merchant, id: string): Promise<Wallet> {
    const wallet = await this.wallets.findOneBy({
      id,
      merchantId: merchant.id,
    });
    if (!wallet) throw new NotFoundException('Carteira não encontrada.');
    return wallet;
  }

  async add(merchant: Merchant, input: AddWalletInput): Promise<void> {
    const hasDefault = await this.wallets.existsBy({
      merchantId: merchant.id,
      network: input.network,
      isDefault: true,
    });
    try {
      await this.wallets.insert({
        merchantId: merchant.id,
        address: input.address,
        network: input.network,
        isDefault: !hasDefault,
      });
    } catch (error) {
      if (isDbError(error, UNIQUE_VIOLATION)) {
        throw new ConflictException('Essa carteira já está cadastrada.');
      }
      throw error;
    }
  }

  /** Remove a carteira; se era a padrão, a mais antiga da rede assume. */
  async remove(merchant: Merchant, id: string): Promise<void> {
    const wallet = await this.findOwned(merchant, id);
    try {
      await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(Wallet);
        await repo.delete(wallet.id);
        if (!wallet.isDefault) return;
        const next = await repo.findOne({
          where: { merchantId: merchant.id, network: wallet.network },
          order: { createdAt: 'ASC' },
        });
        if (next) await repo.update(next.id, { isDefault: true });
      });
    } catch (error) {
      if (isDbError(error, FOREIGN_KEY_VIOLATION)) {
        throw new BadRequestException(
          'Essa carteira já recebeu cobranças e não pode ser removida.',
        );
      }
      throw error;
    }
  }

  networkSettings(merchant: Merchant): NetworkSettingResponse[] {
    return NETWORKS.map((network) => ({
      network,
      isEnabled: merchant.enabledNetworks.includes(network),
    }));
  }
}

function isDbError(error: unknown, code: string): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string }).code === code
  );
}
