import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateJobs1795703444369 implements MigrationInterface {
  name = 'CreateJobs1795703444369';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "jobs" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "type" character varying(50) NOT NULL,
      "payload" jsonb NOT NULL DEFAULT '{}',
      "status" character varying(10) NOT NULL DEFAULT 'pending',
      "attempts" integer NOT NULL DEFAULT '0',
      "max_attempts" integer NOT NULL DEFAULT '6',
      "run_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "locked_until" TIMESTAMP WITH TIME ZONE,
      "last_error" text,
      "finished_at" TIMESTAMP WITH TIME ZONE,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_cf0a6c42b72fcc7f7c237def345" PRIMARY KEY ("id")
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_41842dd8c741ac472b958f04db" ON "jobs" ("status", "run_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "jobs"`);
  }
}
