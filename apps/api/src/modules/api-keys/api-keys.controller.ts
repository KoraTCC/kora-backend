import {
  createApiKeySchema,
  type Acknowledgement,
  type ApiKeyResponse,
  type CreateApiKeyInput,
  type CreatedApiKeyResponse,
  type TestCredentialsResponse,
} from '@kora/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ReqMeta, type RequestMeta } from '../../common/request-meta.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AccessTokenGuard, CurrentUser } from '../auth/access-token.guard.js';
import { MerchantsService } from '../merchants/merchants.service.js';
import type { User } from '../users/user.entity.js';
import { ApiKeysService } from './api-keys.service.js';

@Controller('api-keys')
@UseGuards(AccessTokenGuard)
export class ApiKeysController {
  constructor(
    private readonly merchants: MerchantsService,
    private readonly apiKeys: ApiKeysService,
  ) {}

  @Get()
  async list(@CurrentUser() user: User): Promise<ApiKeyResponse[]> {
    return this.apiKeys.list(await this.merchants.getOrCreateForUser(user));
  }

  @Get('test')
  async testCredentials(
    @CurrentUser() user: User,
  ): Promise<TestCredentialsResponse> {
    return this.apiKeys.testCredentials(
      await this.merchants.getOrCreateForUser(user),
    );
  }

  @Post()
  @HttpCode(201)
  async create(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createApiKeySchema)) _body: CreateApiKeyInput,
    @ReqMeta() meta: RequestMeta,
  ): Promise<CreatedApiKeyResponse> {
    const secretKey = await this.apiKeys.createSecret(
      await this.merchants.getOrCreateForUser(user),
      meta,
    );
    return { secretKey };
  }

  @Post('test/rotate')
  @HttpCode(200)
  async rotate(
    @CurrentUser() user: User,
    @ReqMeta() meta: RequestMeta,
  ): Promise<CreatedApiKeyResponse> {
    const secretKey = await this.apiKeys.rotateSecret(
      await this.merchants.getOrCreateForUser(user),
      meta,
    );
    return { secretKey };
  }

  @Delete(':id')
  async revoke(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @ReqMeta() meta: RequestMeta,
  ): Promise<Acknowledgement> {
    await this.apiKeys.revoke(
      await this.merchants.getOrCreateForUser(user),
      id,
      meta,
    );
    return { ok: true };
  }
}
