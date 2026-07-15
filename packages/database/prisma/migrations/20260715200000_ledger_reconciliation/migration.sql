-- CreateEnum
CREATE TYPE "LedgerAccountCategory" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE', 'CLEARING');
CREATE TYPE "ReconciliationKind" AS ENUM ('MONTHLY_CONVERSION', 'HELOC_INTEREST', 'DAILY_REPORT');

-- AlterTable LedgerEntry
ALTER TABLE "ledger_entries"
  ADD COLUMN "strategy_id" UUID,
  ADD COLUMN "interest_cycle_id" UUID,
  ADD COLUMN "account_category" "LedgerAccountCategory" NOT NULL DEFAULT 'ASSET',
  ADD COLUMN "provider_ref_type" TEXT,
  ADD COLUMN "provider_ref_id" TEXT,
  ADD COLUMN "reverses_business_event_id" TEXT;

-- Backfill category from financial account kind
UPDATE "ledger_entries" AS e
SET "account_category" = CASE a.kind
  WHEN 'MORTGAGE' THEN 'LIABILITY'::"LedgerAccountCategory"
  WHEN 'HELOC' THEN 'LIABILITY'::"LedgerAccountCategory"
  WHEN 'BANK_OPERATING' THEN 'ASSET'::"LedgerAccountCategory"
  WHEN 'BROKERAGE_CASH' THEN 'ASSET'::"LedgerAccountCategory"
  WHEN 'BROKERAGE_POSITION' THEN 'ASSET'::"LedgerAccountCategory"
  ELSE 'CLEARING'::"LedgerAccountCategory"
END
FROM "financial_accounts" AS a
WHERE a.id = e.account_id AND a.tenant_id = e.tenant_id;

ALTER TABLE "ledger_entries" ALTER COLUMN "account_category" DROP DEFAULT;

CREATE INDEX "ledger_entries_tenant_id_interest_cycle_id_idx" ON "ledger_entries"("tenant_id", "interest_cycle_id");
CREATE INDEX "ledger_entries_tenant_id_strategy_id_idx" ON "ledger_entries"("tenant_id", "strategy_id");
CREATE INDEX "ledger_entries_tenant_id_provider_ref_type_provider_ref_id_idx"
  ON "ledger_entries"("tenant_id", "provider_ref_type", "provider_ref_id");

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_strategy_id_tenant_id_fkey"
  FOREIGN KEY ("strategy_id", "tenant_id") REFERENCES "strategies"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_interest_cycle_id_tenant_id_fkey"
  FOREIGN KEY ("interest_cycle_id", "tenant_id") REFERENCES "interest_cycles"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable Reconciliation
ALTER TABLE "reconciliations"
  ADD COLUMN "kind" "ReconciliationKind" NOT NULL DEFAULT 'MONTHLY_CONVERSION',
  ADD COLUMN "interest_cycle_id" UUID;

CREATE INDEX "reconciliations_tenant_id_interest_cycle_id_idx" ON "reconciliations"("tenant_id", "interest_cycle_id");
CREATE INDEX "reconciliations_tenant_id_kind_created_at_idx" ON "reconciliations"("tenant_id", "kind", "created_at");

ALTER TABLE "reconciliations"
  ADD CONSTRAINT "reconciliations_interest_cycle_id_tenant_id_fkey"
  FOREIGN KEY ("interest_cycle_id", "tenant_id") REFERENCES "interest_cycles"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable DailyReconciliationReport
CREATE TABLE "daily_reconciliation_reports" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "report_date" DATE NOT NULL,
  "conversion_passed_count" INTEGER NOT NULL,
  "conversion_failed_count" INTEGER NOT NULL,
  "interest_passed_count" INTEGER NOT NULL,
  "interest_failed_count" INTEGER NOT NULL,
  "ledger_debit_cents" BIGINT NOT NULL,
  "ledger_credit_cents" BIGINT NOT NULL,
  "ledger_balanced" BOOLEAN NOT NULL,
  "summary_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_reconciliation_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "daily_reconciliation_reports_tenant_id_report_date_key"
  ON "daily_reconciliation_reports"("tenant_id", "report_date");
CREATE UNIQUE INDEX "daily_reconciliation_reports_id_tenant_id_key"
  ON "daily_reconciliation_reports"("id", "tenant_id");
CREATE INDEX "daily_reconciliation_reports_tenant_id_report_date_idx"
  ON "daily_reconciliation_reports"("tenant_id", "report_date");

ALTER TABLE "daily_reconciliation_reports"
  ADD CONSTRAINT "daily_reconciliation_reports_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
