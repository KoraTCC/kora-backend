import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWebhookEndpoints1793194643264 implements MigrationInterface {
  name = 'CreateWebhookEndpoints1793194643264';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "merchants" ADD "webhook_secret" character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "merchants" ADD "webhook_events" character varying array NOT NULL DEFAULT '{charge.created,charge.detected,charge.confirmed,charge.partial,charge.expired,charge.failed}'`,
    );
    await queryRunner.query(`CREATE TABLE "webhook_endpoints" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "merchant_id" uuid NOT NULL,
      "url" character varying(255) NOT NULL,
      "status" character varying(10) NOT NULL DEFAULT 'active',
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_054c4cfb95223732f5939d2d546" PRIMARY KEY ("id")
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_a10c384003f1a413769236ef6d" ON "webhook_endpoints" ("merchant_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_25a51750b561232fd72a886d13" ON "webhook_endpoints" ("merchant_id", "url")`,
    );
    await queryRunner.query(
      `ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "FK_a10c384003f1a413769236ef6d8" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "webhook_endpoints"`);
    await queryRunner.query(
      `ALTER TABLE "merchants" DROP COLUMN "webhook_events"`,
    );
    await queryRunner.query(
      `ALTER TABLE "merchants" DROP COLUMN "webhook_secret"`,
    );
  }
}
