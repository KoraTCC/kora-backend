import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateApiKeysAndBillingSettings1793195124287 implements MigrationInterface {
  name = 'CreateApiKeysAndBillingSettings1793195124287';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "api_keys" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "merchant_id" uuid NOT NULL,
      "kind" character varying(15) NOT NULL,
      "environment" character varying(10) NOT NULL DEFAULT 'test',
      "prefix" character varying(16) NOT NULL,
      "last4" character varying(4) NOT NULL,
      "key_hash" character(64),
      "public_key" character varying(64),
      "last_used_at" TIMESTAMP WITH TIME ZONE,
      "revoked_at" TIMESTAMP WITH TIME ZONE,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_5c8a79801b44bd27b79228e1dad" PRIMARY KEY ("id")
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_8261f83ab065c7bb551dd3f375" ON "api_keys" ("merchant_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_57384430aa1959f4578046c9b8" ON "api_keys" ("key_hash")`,
    );
    await queryRunner.query(
      `ALTER TABLE "api_keys" ADD CONSTRAINT "FK_8261f83ab065c7bb551dd3f375a" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "merchants" ADD "billing_settings" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "merchants" DROP COLUMN "billing_settings"`,
    );
    await queryRunner.query(`DROP TABLE "api_keys"`);
  }
}
