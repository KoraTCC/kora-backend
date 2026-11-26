import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTwoFactorAuth1795700724195 implements MigrationInterface {
  name = 'AddTwoFactorAuth1795700724195';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "two_factor_secret" text`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "two_factor_pending_secret" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "two_factor_enabled_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "two_factor_last_step" bigint`,
    );
    await queryRunner.query(`CREATE TABLE "two_factor_recovery_codes" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "user_id" uuid NOT NULL,
      "code_hash" character(64) NOT NULL,
      "used_at" TIMESTAMP WITH TIME ZONE,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_6f535a18c9fb9da8cc9b7ea70dc" PRIMARY KEY ("id")
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_dd306548ffdd22f61714667084" ON "two_factor_recovery_codes" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_7dc82e2ec08635bb66ee2be026" ON "two_factor_recovery_codes" ("code_hash")`,
    );
    await queryRunner.query(
      `ALTER TABLE "two_factor_recovery_codes" ADD CONSTRAINT "FK_dd306548ffdd22f617146670845" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "two_factor_recovery_codes"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "two_factor_last_step"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "two_factor_enabled_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "two_factor_pending_secret"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "two_factor_secret"`,
    );
  }
}
