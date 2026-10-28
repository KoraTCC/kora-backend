import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { MerchantsModule } from '../merchants/merchants.module.js';
import { Wallet } from './wallet.entity.js';
import { WalletsController } from './wallets.controller.js';
import { WalletsService } from './wallets.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Wallet]), AuthModule, MerchantsModule],
  controllers: [WalletsController],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule {}
