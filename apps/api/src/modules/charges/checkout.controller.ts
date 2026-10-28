import type { CheckoutResponse } from '@kora/contracts';
import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ChargesService } from './charges.service.js';

/** Rotas públicas (sem login) da página de pagamento do cliente. */
@Controller('public/checkout')
export class CheckoutController {
  constructor(private readonly charges: ChargesService) {}

  // A página consulta a cada 3 s enquanto espera o pagamento (20/min).
  @Get(':chargeId')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  get(
    @Param('chargeId', new ParseUUIDPipe({ errorHttpStatusCode: 404 }))
    chargeId: string,
  ): Promise<CheckoutResponse> {
    return this.charges.getPublicCheckout(chargeId);
  }
}
