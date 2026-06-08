CREATE TYPE "DealAsset" AS ENUM ('TON');
CREATE TYPE "DealStatus" AS ENUM ('CREATED','WAITING_DEPOSIT','FUNDED','DELIVERED','DISPUTED','RELEASED','REFUNDED','EXPIRED','CANCELLED');
CREATE TABLE "users" (
  "id" TEXT NOT NULL, "telegram_id" BIGINT NOT NULL, "username" TEXT, "wallet_address" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "deals" (
  "id" TEXT NOT NULL, "deal_code" TEXT NOT NULL, "buyer_telegram_id" BIGINT NOT NULL, "seller_telegram_id" BIGINT NOT NULL,
  "buyer_wallet" TEXT, "seller_wallet" TEXT, "escrow_address" TEXT, "amount_nano" BIGINT NOT NULL,
  "asset" "DealAsset" NOT NULL DEFAULT 'TON', "description" TEXT NOT NULL, "status" "DealStatus" NOT NULL DEFAULT 'WAITING_DEPOSIT',
  "evidence_hash" TEXT, "tx_hash_deposit" TEXT, "tx_hash_release" TEXT, "tx_hash_refund" TEXT, "chain_lt" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL, "deadline_at" TIMESTAMP(3),
  CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_telegram_id_key" ON "users"("telegram_id");
CREATE UNIQUE INDEX "deals_deal_code_key" ON "deals"("deal_code");
CREATE INDEX "deals_buyer_telegram_id_status_idx" ON "deals"("buyer_telegram_id", "status");
CREATE INDEX "deals_seller_telegram_id_status_idx" ON "deals"("seller_telegram_id", "status");
CREATE INDEX "deals_escrow_address_idx" ON "deals"("escrow_address");
ALTER TABLE "deals" ADD CONSTRAINT "deals_buyer_telegram_id_fkey" FOREIGN KEY ("buyer_telegram_id") REFERENCES "users"("telegram_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deals" ADD CONSTRAINT "deals_seller_telegram_id_fkey" FOREIGN KEY ("seller_telegram_id") REFERENCES "users"("telegram_id") ON DELETE RESTRICT ON UPDATE CASCADE;
