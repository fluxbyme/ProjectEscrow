ALTER TABLE "deals"
  ADD COLUMN "token_address" TEXT,
  ADD COLUMN "delivery_proof" TEXT,
  ADD COLUMN "dispute_reason" TEXT,
  ADD COLUMN "dispute_evidence" TEXT,
  ADD COLUMN "resolution_note" TEXT,
  ADD COLUMN "acceptance_deadline_at" TIMESTAMP(3),
  ADD COLUMN "accepted_at" TIMESTAMP(3),
  ADD COLUMN "delivery_timeout_seconds" INTEGER;

UPDATE "deals"
SET
  "acceptance_deadline_at" = "created_at" + INTERVAL '1 day',
  "delivery_timeout_seconds" = GREATEST(
    3600,
    EXTRACT(EPOCH FROM ("delivery_deadline_at" - "created_at"))::INTEGER
  ),
  "token_address" = CASE WHEN "currency" = 'USDT' THEN '' ELSE NULL END;

ALTER TABLE "deals"
  ALTER COLUMN "acceptance_deadline_at" SET NOT NULL,
  ALTER COLUMN "delivery_timeout_seconds" SET NOT NULL,
  ALTER COLUMN "deposit_deadline_at" DROP NOT NULL,
  ALTER COLUMN "delivery_deadline_at" DROP NOT NULL;

CREATE TYPE "EvidenceKind" AS ENUM ('DELIVERY', 'DISPUTE');
CREATE TABLE "deal_evidence" (
  "id" TEXT NOT NULL,
  "deal_id" TEXT NOT NULL,
  "uploader_telegram_id" BIGINT NOT NULL,
  "kind" "EvidenceKind" NOT NULL,
  "filename" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "storage_key" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "deal_evidence_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "deal_evidence_deal_id_kind_idx" ON "deal_evidence"("deal_id", "kind");
ALTER TABLE "deal_evidence" ADD CONSTRAINT "deal_evidence_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
