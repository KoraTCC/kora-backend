import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { MerchantsModule } from '../merchants/merchants.module.js';
import { WebhookEndpoint } from './webhook-endpoint.entity.js';
import { WebhooksController } from './webhooks.controller.js';
import { WebhooksService } from './webhooks.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([WebhookEndpoint]),
    AuthModule,
    MerchantsModule,
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
