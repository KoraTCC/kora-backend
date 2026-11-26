import { buildDataSourceOptions } from '@kora/database';
import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ENV, loadEnv, type Env } from './config/env.js';
import { buildJobHandlers, JOB_HANDLERS } from './queue/job-handlers.js';
import { WorkerService } from './worker.service.js';

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }],
  exports: [ENV],
})
class ConfigModule {}

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => buildDataSourceOptions(env.DATABASE_URL),
    }),
  ],
  providers: [
    { provide: JOB_HANDLERS, useFactory: buildJobHandlers },
    WorkerService,
  ],
})
export class AppModule {}
