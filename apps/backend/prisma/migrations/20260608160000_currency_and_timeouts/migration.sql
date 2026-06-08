ALTER TYPE "DealAsset" RENAME TO "DealCurrency";
ALTER TYPE "DealCurrency" ADD VALUE IF NOT EXISTS 'USDT';

ALTER TABLE "deals" RENAME COLUMN "asset" TO "currency";
ALTER TABLE "deals" RENAME COLUMN "deadline_at" TO "delivery_deadline_at";
ALTER TABLE "deals"
  ADD COLUMN "deposit_deadline_at" TIMESTAMP(3),
  ADD COLUMN "action_deadline_at" TIMESTAMP(3),
  ADD COLUMN "last_reminder_key" TEXT,
  ADD COLUMN "timeout_requested_at" TIMESTAMP(3);

UPDATE "deals"
SET
  "deposit_deadline_at" = "created_at" + INTERVAL '1 day',
  "delivery_deadline_at" = COALESCE("delivery_deadline_at", "created_at" + INTERVAL '7 days'),
  "action_deadline_at" = CASE
    WHEN "status" = 'WAITING_DEPOSIT' THEN "created_at" + INTERVAL '1 day'
    WHEN "status" IN ('FUNDED', 'DELIVERED', 'DISPUTED') THEN COALESCE("delivery_deadline_at", "created_at" + INTERVAL '7 days')
    ELSE NULL
  END;

ALTER TABLE "deals"
  ALTER COLUMN "deposit_deadline_at" SET NOT NULL,
  ALTER COLUMN "delivery_deadline_at" SET NOT NULL;

CREATE INDEX "deals_status_action_deadline_at_idx" ON "deals"("status", "action_deadline_at");
