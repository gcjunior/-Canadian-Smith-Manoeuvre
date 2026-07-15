-- CreateEnum
CREATE TYPE "InterestCycleState" AS ENUM (
  'SCHEDULED',
  'AWAITING_CHARGE',
  'AWAITING_DEBIT',
  'RECONCILING',
  'COMPLETED',
  'PAUSED',
  'FAILED'
);

-- AlterTable Strategy
ALTER TABLE "strategies"
  ADD COLUMN "expected_interest_charge_day" INTEGER NOT NULL DEFAULT 1;

-- AlterTable StrategySchedule
ALTER TABLE "strategy_schedules"
  ADD COLUMN "temporal_interest_schedule_id" TEXT,
  ADD COLUMN "expected_interest_charge_day" INTEGER NOT NULL DEFAULT 1;

-- AlterTable HelocInterestPayment
ALTER TABLE "heloc_interest_payments"
  ADD COLUMN "provider_debit_id" TEXT,
  ADD COLUMN "failure_code" TEXT;

-- Unique one charge per HELOC per period
CREATE UNIQUE INDEX "heloc_interest_charges_tenant_id_heloc_id_interest_period_key"
  ON "heloc_interest_charges"("tenant_id", "heloc_id", "interest_period");

-- CreateTable InterestCycle
CREATE TABLE "interest_cycles" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "strategy_id" UUID NOT NULL,
  "interest_period" TEXT NOT NULL,
  "state" "InterestCycleState" NOT NULL DEFAULT 'SCHEDULED',
  "correlation_id" UUID NOT NULL,
  "charge_id" UUID,
  "payment_id" UUID,
  "failure_code" TEXT,
  "failure_message" TEXT,
  "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,

  CONSTRAINT "interest_cycles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "interest_cycles_tenant_id_strategy_id_interest_period_key"
  ON "interest_cycles"("tenant_id", "strategy_id", "interest_period");
CREATE UNIQUE INDEX "interest_cycles_id_tenant_id_key"
  ON "interest_cycles"("id", "tenant_id");
CREATE INDEX "interest_cycles_tenant_id_strategy_id_state_idx"
  ON "interest_cycles"("tenant_id", "strategy_id", "state");
CREATE INDEX "interest_cycles_tenant_id_correlation_id_idx"
  ON "interest_cycles"("tenant_id", "correlation_id");

ALTER TABLE "interest_cycles"
  ADD CONSTRAINT "interest_cycles_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "interest_cycles"
  ADD CONSTRAINT "interest_cycles_strategy_id_tenant_id_fkey"
  FOREIGN KEY ("strategy_id", "tenant_id") REFERENCES "strategies"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "interest_cycles"
  ADD CONSTRAINT "interest_cycles_charge_id_tenant_id_fkey"
  FOREIGN KEY ("charge_id", "tenant_id") REFERENCES "heloc_interest_charges"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "interest_cycles"
  ADD CONSTRAINT "interest_cycles_payment_id_tenant_id_fkey"
  FOREIGN KEY ("payment_id", "tenant_id") REFERENCES "heloc_interest_payments"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
