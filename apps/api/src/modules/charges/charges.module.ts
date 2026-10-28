import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { MerchantsModule } from '../merchants/merchants.module.js';
import { WalletsModule } from '../wallets/wallets.module.js';
import { Charge } from './charge.entity.js';
import { ChargesController } from './charges.controller.js';
import { ChargesService } from './charges.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Charge]),
    AuthModule,
    AuditModule,
    MerchantsModule,
    WalletsModule,
  ],
  controllers: [ChargesController],
  providers: [ChargesService],
})
export class ChargesModule {}
