-- CreateEnum
CREATE TYPE "WebhookProcessingState" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'RETAINED', 'RETRYABLE', 'DEAD_LETTERED');

-- AlterTable
ALTER TABLE "provider_webhook_events"
  ADD COLUMN "processing_state" "WebhookProcessingState" NOT NULL DEFAULT 'RECEIVED',
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "next_attempt_at" TIMESTAMPTZ(3),
  ADD COLUMN "last_error" TEXT,
  ADD COLUMN "dead_letter_reason" TEXT,
  ADD COLUMN "financial_account_id" UUID,
  ADD COLUMN "strategy_id" UUID,
  ADD COLUMN "payment_period" TEXT,
  ADD COLUMN "outcome" TEXT,
  ADD COLUMN "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "provider_webhook_events_processing_state_next_attempt_at_idx" ON "provider_webhook_events"("processing_state", "next_attempt_at");

-- Backfill: already-processed rows
UPDATE "provider_webhook_events"
SET "processing_state" = 'PROCESSED',
    "updated_at" = CURRENT_TIMESTAMP
WHERE "processed_at" IS NOT NULL;
