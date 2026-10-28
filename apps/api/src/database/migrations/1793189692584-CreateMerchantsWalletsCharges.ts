import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMerchantsWalletsCharges1793189692584 implements MigrationInterface {
  name = 'CreateMerchantsWalletsCharges1793189692584';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "merchants" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "user_id" uuid NOT NULL,
      "name" character varying(100) NOT NULL,
      "legal_name" character varying(150) NOT NULL DEFAULT '',
      "document" character varying(20) NOT NULL DEFAULT '',
      "phone" character varying(30) NOT NULL DEFAULT '',
      "email" character varying(254) NOT NULL DEFAULT '',
      "website" character varying(255) NOT NULL DEFAULT '',
      "environment" character varying(10) NOT NULL DEFAULT 'test',
      "status" character varying(20) NOT NULL DEFAULT 'active',
      "display_name" character varying(100) NOT NULL,
      "show_logo" boolean NOT NULL DEFAULT true,
      "show_back_button" boolean NOT NULL DEFAULT true,
      "postal_code" character varying(10) NOT NULL DEFAULT '',
      "street" character varying(200) NOT NULL DEFAULT '',
      "complement" character varying(100) NOT NULL DEFAULT '',
      "city" character varying(100) NOT NULL DEFAULT '',
      "state" character varying(2) NOT NULL DEFAULT '',
      "country" character varying(2) NOT NULL DEFAULT 'BR',
      "enabled_networks" character varying array NOT NULL DEFAULT '{sepolia,amoy,bitcoin-testnet}',
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "REL_698f612a3134c503f711479a4e" UNIQUE ("user_id"),
      CONSTRAINT "PK_4fd312ef25f8e05ad47bfe7ed25" PRIMARY KEY ("id")
    )`);

    await queryRunner.query(`CREATE TABLE "wallets" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "merchant_id" uuid NOT NULL,
      "address" character varying(90) NOT NULL,
      "network" character varying(30) NOT NULL,
      "is_default" boolean NOT NULL DEFAULT false,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_8402e5df5a30a229380e83e4f7e" PRIMARY KEY ("id")
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_64c3c9dd2323f27efbe86f4a96" ON "wallets" ("merchant_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_6a0bc7861a2ddcb37ee10fec9f" ON "wallets" ("merchant_id", "network", "address")`,
    );

    await queryRunner.query(`CREATE TABLE "charges" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "merchant_id" uuid NOT NULL,
      "wallet_id" uuid NOT NULL,
      "reference" character varying(80) NOT NULL,
      "origin" character varying(20) NOT NULL,
      "customer_email" character varying(254),
      "description" character varying(120) NOT NULL DEFAULT '',
      "amount_cents" integer NOT NULL,
      "crypto_amount" numeric(30,8) NOT NULL,
      "asset" character varying(10) NOT NULL,
      "network" character varying(30) NOT NULL,
      "address" character varying(90) NOT NULL,
      "status" character varying(20) NOT NULL DEFAULT 'pending',
      "confirmations" integer NOT NULL DEFAULT '0',
      "required_confirmations" integer NOT NULL,
      "tolerance" numeric(6,4) NOT NULL DEFAULT '0',
      "locked_rate_cents" bigint NOT NULL,
      "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      "tx_hash" character varying(100),
      "block_number" bigint,
      "received_crypto_amount" numeric(30,8),
      "detected_at" TIMESTAMP WITH TIME ZONE,
      "confirmed_at" TIMESTAMP WITH TIME ZONE,
      "failed_at" TIMESTAMP WITH TIME ZONE,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_0c6feb10df0fa460714f8464dce" PRIMARY KEY ("id")
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_30e76422ca2325961b91e303ea" ON "charges" ("wallet_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b9667cd4405b5115530dcc87f2" ON "charges" ("merchant_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_024ea9cdffa35c021815b938bf" ON "charges" ("merchant_id", "created_at")`,
    );

    await queryRunner.query(
      `ALTER TABLE "merchants" ADD CONSTRAINT "FK_698f612a3134c503f711479a4e5" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallets" ADD CONSTRAINT "FK_64c3c9dd2323f27efbe86f4a961" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "charges" ADD CONSTRAINT "FK_df8224d18ea8a0f56c36fdfe89d" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "charges" ADD CONSTRAINT "FK_30e76422ca2325961b91e303ea0" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "charges"`);
    await queryRunner.query(`DROP TABLE "wallets"`);
    await queryRunner.query(`DROP TABLE "merchants"`);
  }
}
