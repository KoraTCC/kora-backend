import { Global, Module } from '@nestjs/common';
import { ENV, type Env } from '../config/env.js';
import { SecretBox } from './secret-box.js';

/** Disponibiliza o `SecretBox` (chave de `DATA_ENCRYPTION_KEY`) para todos. */
@Global()
@Module({
  providers: [
    {
      provide: SecretBox,
      inject: [ENV],
      useFactory: (env: Env) => new SecretBox(env.DATA_ENCRYPTION_KEY),
    },
  ],
  exports: [SecretBox],
})
export class SecretBoxModule {}
