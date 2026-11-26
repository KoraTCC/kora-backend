import {
  dashboardQuerySchema,
  type DashboardOverviewResponse,
  type DashboardQuery,
} from '@kora/contracts';
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AccessTokenGuard, CurrentUser } from '../auth/access-token.guard.js';
import { MerchantsService } from '../merchants/merchants.service.js';
import type { User } from '../users/user.entity.js';
import { DashboardService } from './dashboard.service.js';

@Controller('dashboard')
@UseGuards(AccessTokenGuard)
export class DashboardController {
  constructor(
    private readonly merchants: MerchantsService,
    private readonly dashboard: DashboardService,
  ) {}

  @Get()
  async overview(
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(dashboardQuerySchema)) query: DashboardQuery,
  ): Promise<DashboardOverviewResponse> {
    return this.dashboard.overview(
      await this.merchants.getOrCreateForUser(user),
      query.range,
    );
  }
}
