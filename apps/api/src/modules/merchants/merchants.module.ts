import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { BillingSettingsController } from './billing-settings.controller.js';
import { Merchant } from './merchant.entity.js';
import { MerchantsController } from './merchants.controller.js';
import { MerchantsService } from './merchants.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Merchant]), AuthModule],
  controllers: [MerchantsController, BillingSettingsController],
  providers: [MerchantsService],
  exports: [MerchantsService],
})
export class MerchantsModule {}
