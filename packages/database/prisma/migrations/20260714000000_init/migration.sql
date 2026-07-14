-- CreateEnum
CREATE TYPE "StrategyState" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "FinancialAccountKind" AS ENUM ('MORTGAGE', 'HELOC', 'BANK_OPERATING', 'BROKERAGE_CASH', 'BROKERAGE_POSITION');

-- CreateEnum
CREATE TYPE "FinancialProviderType" AS ENUM ('BANK', 'BROKERAGE');

-- CreateEnum
CREATE TYPE "BrokerageRegistrationType" AS ENUM ('NON_REGISTERED');

-- CreateEnum
CREATE TYPE "MonthlyConversionCycleState" AS ENUM ('SCHEDULED', 'WAITING_FOR_MORTGAGE', 'WAITING_FOR_HELOC', 'HELOC_DRAW_PENDING', 'HELOC_DRAW_CONFIRMED', 'BROKERAGE_TRANSFER_PENDING', 'BROKERAGE_FUNDED', 'ORDER_PENDING', 'ORDER_FILLED', 'RECONCILING', 'COMPLETED', 'PAUSED', 'FAILED');

-- CreateEnum
CREATE TYPE "MoneyMovementState" AS ENUM ('REQUESTED', 'PENDING', 'SETTLED', 'FAILED', 'UNKNOWN', 'REVERSED');

-- CreateEnum
CREATE TYPE "MoneyMovementType" AS ENUM ('HELOC_DRAW', 'HELOC_TO_BROKERAGE_TRANSFER', 'BROKERAGE_DEPOSIT', 'INTEREST_BANK_DEBIT', 'OTHER');

-- CreateEnum
CREATE TYPE "InvestmentOrderState" AS ENUM ('CREATED', 'SUBMITTED', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "InvestmentOrderSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "MortgagePaymentState" AS ENUM ('PENDING', 'SETTLED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HelocInterestChargeState" AS ENUM ('PENDING', 'POSTED', 'FAILED');

-- CreateEnum
CREATE TYPE "HelocInterestPaymentState" AS ENUM ('PENDING', 'SETTLED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReconciliationState" AS ENUM ('PENDING', 'PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReconciliationItemResult" AS ENUM ('PASS', 'FAIL', 'WARN');

-- CreateEnum
CREATE TYPE "IdempotencyRecordState" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "OperationalExceptionSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "OperationalExceptionState" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "WorkflowReferenceType" AS ENUM ('MONTHLY_CONVERSION', 'HELOC_INTEREST', 'OTHER');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'SYSTEM', 'WORKER', 'WEBHOOK', 'OPERATOR');

-- CreateEnum
CREATE TYPE "LedgerEntryDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "password_hash" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_connections" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider_type" "FinancialProviderType" NOT NULL,
    "provider_connection_id" TEXT NOT NULL,
    "display_alias" TEXT NOT NULL,
    "metadata_redacted" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "financial_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_accounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "kind" "FinancialAccountKind" NOT NULL,
    "currency_code" CHAR(3) NOT NULL DEFAULT 'CAD',
    "display_alias" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "account_number_last4" VARCHAR(4),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mortgages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "outstanding_principal_cents" BIGINT NOT NULL,
    "contractual_payment_cents" BIGINT NOT NULL,
    "expected_payment_day" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "mortgages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "helocs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "credit_limit_cents" BIGINT NOT NULL,
    "balance_owed_cents" BIGINT NOT NULL,
    "available_credit_cents" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "helocs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brokerage_accounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "registration_type" "BrokerageRegistrationType" NOT NULL DEFAULT 'NON_REGISTERED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "brokerage_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordinary_bank_accounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ordinary_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "state" "StrategyState" NOT NULL DEFAULT 'DRAFT',
    "timezone" TEXT NOT NULL,
    "expected_payment_day" INTEGER NOT NULL,
    "mortgage_account_id" UUID NOT NULL,
    "heloc_account_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "brokerage_account_id" UUID NOT NULL,
    "pause_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_investment_policies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "strategy_id" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL DEFAULT 'TSX',
    "user_monthly_cap_cents" BIGINT NOT NULL,
    "allow_fractional_shares" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "strategy_investment_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mortgage_payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "mortgage_id" UUID NOT NULL,
    "provider_payment_id" TEXT NOT NULL,
    "payment_period" TEXT NOT NULL,
    "total_amount_cents" BIGINT NOT NULL,
    "principal_amount_cents" BIGINT NOT NULL,
    "interest_amount_cents" BIGINT NOT NULL,
    "state" "MortgagePaymentState" NOT NULL DEFAULT 'PENDING',
    "paid_at" TIMESTAMPTZ(3),
    "settled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "mortgage_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "heloc_credit_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "heloc_id" UUID NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "available_credit_cents" BIGINT NOT NULL,
    "credit_delta_cents" BIGINT NOT NULL,
    "related_payment_period" TEXT,
    "observed_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "heloc_credit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "heloc_interest_charges" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "heloc_id" UUID NOT NULL,
    "provider_charge_id" TEXT NOT NULL,
    "interest_period" TEXT NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "state" "HelocInterestChargeState" NOT NULL DEFAULT 'PENDING',
    "posted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "heloc_interest_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "heloc_interest_payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "charge_id" UUID NOT NULL,
    "ordinary_bank_account_id" UUID NOT NULL,
    "provider_payment_id" TEXT NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "state" "HelocInterestPaymentState" NOT NULL DEFAULT 'PENDING',
    "settled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "heloc_interest_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_conversion_cycles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "strategy_id" UUID NOT NULL,
    "payment_period" TEXT NOT NULL,
    "state" "MonthlyConversionCycleState" NOT NULL DEFAULT 'SCHEDULED',
    "mortgage_payment_id" UUID,
    "principal_repaid_cents" BIGINT,
    "newly_available_credit_cents" BIGINT,
    "draw_amount_cents" BIGINT,
    "correlation_id" UUID NOT NULL,
    "failure_code" TEXT,
    "failure_message" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "monthly_conversion_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "money_movements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cycle_id" UUID,
    "type" "MoneyMovementType" NOT NULL,
    "state" "MoneyMovementState" NOT NULL DEFAULT 'REQUESTED',
    "amount_cents" BIGINT NOT NULL,
    "currency_code" CHAR(3) NOT NULL DEFAULT 'CAD',
    "source_account_id" UUID,
    "destination_account_id" UUID,
    "provider_transaction_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "correlation_id" UUID NOT NULL,
    "failure_code" TEXT,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "money_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brokerage_deposits" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cycle_id" UUID,
    "brokerage_account_id" UUID NOT NULL,
    "money_movement_id" UUID NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "state" "MoneyMovementState" NOT NULL DEFAULT 'REQUESTED',
    "provider_deposit_id" TEXT NOT NULL,
    "settled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "brokerage_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cycle_id" UUID,
    "brokerage_account_id" UUID NOT NULL,
    "provider_order_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" "InvestmentOrderSide" NOT NULL DEFAULT 'BUY',
    "state" "InvestmentOrderState" NOT NULL DEFAULT 'CREATED',
    "notional_cents" BIGINT NOT NULL,
    "quantity" DECIMAL(28,10),
    "limit_price" DECIMAL(28,10),
    "correlation_id" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(3),
    "filled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "investment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_fills" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "provider_fill_id" TEXT NOT NULL,
    "quantity" DECIMAL(28,10) NOT NULL,
    "price" DECIMAL(28,10) NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "filled_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investment_fills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "cycle_id" UUID,
    "business_event_id" TEXT NOT NULL,
    "direction" "LedgerEntryDirection" NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "currency_code" CHAR(3) NOT NULL DEFAULT 'CAD',
    "correlation_id" UUID NOT NULL,
    "narrative" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "strategy_id" UUID NOT NULL,
    "cycle_id" UUID,
    "state" "ReconciliationState" NOT NULL DEFAULT 'PENDING',
    "correlation_id" UUID NOT NULL,
    "summary" TEXT,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "reconciliation_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "result" "ReconciliationItemResult" NOT NULL,
    "expected_value" TEXT,
    "actual_value" TEXT,
    "detail" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "state" "IdempotencyRecordState" NOT NULL DEFAULT 'IN_PROGRESS',
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_webhook_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload_redacted" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operational_exceptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "strategy_id" UUID,
    "cycle_id" UUID,
    "code" TEXT NOT NULL,
    "severity" "OperationalExceptionSeverity" NOT NULL DEFAULT 'ERROR',
    "state" "OperationalExceptionState" NOT NULL DEFAULT 'OPEN',
    "message" TEXT NOT NULL,
    "details" JSONB,
    "correlation_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "operational_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID,
    "correlation_id" UUID,
    "payload_redacted" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_references" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "strategy_id" UUID NOT NULL,
    "cycle_id" UUID,
    "type" "WorkflowReferenceType" NOT NULL,
    "temporal_workflow_id" TEXT NOT NULL,
    "temporal_run_id" TEXT,
    "temporal_namespace" TEXT NOT NULL DEFAULT 'default',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workflow_references_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "users_id_tenant_id_key" ON "users"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "financial_connections_tenant_id_user_id_idx" ON "financial_connections"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_connections_tenant_id_provider_type_provider_conn_key" ON "financial_connections"("tenant_id", "provider_type", "provider_connection_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_connections_id_tenant_id_key" ON "financial_connections"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "financial_accounts_tenant_id_user_id_idx" ON "financial_accounts"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "financial_accounts_tenant_id_kind_idx" ON "financial_accounts"("tenant_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "financial_accounts_tenant_id_connection_id_provider_account_key" ON "financial_accounts"("tenant_id", "connection_id", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_accounts_id_tenant_id_key" ON "financial_accounts"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_accounts_id_tenant_id_user_id_key" ON "financial_accounts"("id", "tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "mortgages_account_id_key" ON "mortgages"("account_id");

-- CreateIndex
CREATE INDEX "mortgages_tenant_id_idx" ON "mortgages"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "mortgages_account_id_tenant_id_key" ON "mortgages"("account_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "mortgages_id_tenant_id_key" ON "mortgages"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "helocs_account_id_key" ON "helocs"("account_id");

-- CreateIndex
CREATE INDEX "helocs_tenant_id_idx" ON "helocs"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "helocs_account_id_tenant_id_key" ON "helocs"("account_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "helocs_id_tenant_id_key" ON "helocs"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "brokerage_accounts_account_id_key" ON "brokerage_accounts"("account_id");

-- CreateIndex
CREATE INDEX "brokerage_accounts_tenant_id_idx" ON "brokerage_accounts"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "brokerage_accounts_account_id_tenant_id_key" ON "brokerage_accounts"("account_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "brokerage_accounts_id_tenant_id_key" ON "brokerage_accounts"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "ordinary_bank_accounts_account_id_key" ON "ordinary_bank_accounts"("account_id");

-- CreateIndex
CREATE INDEX "ordinary_bank_accounts_tenant_id_idx" ON "ordinary_bank_accounts"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "ordinary_bank_accounts_account_id_tenant_id_key" ON "ordinary_bank_accounts"("account_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "ordinary_bank_accounts_id_tenant_id_key" ON "ordinary_bank_accounts"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "strategies_tenant_id_user_id_idx" ON "strategies"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "strategies_tenant_id_state_idx" ON "strategies"("tenant_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "strategies_id_tenant_id_key" ON "strategies"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "strategy_investment_policies_strategy_id_key" ON "strategy_investment_policies"("strategy_id");

-- CreateIndex
CREATE INDEX "strategy_investment_policies_tenant_id_idx" ON "strategy_investment_policies"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "strategy_investment_policies_strategy_id_tenant_id_key" ON "strategy_investment_policies"("strategy_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "strategy_investment_policies_id_tenant_id_key" ON "strategy_investment_policies"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "mortgage_payments_tenant_id_mortgage_id_payment_period_idx" ON "mortgage_payments"("tenant_id", "mortgage_id", "payment_period");

-- CreateIndex
CREATE UNIQUE INDEX "mortgage_payments_tenant_id_provider_payment_id_key" ON "mortgage_payments"("tenant_id", "provider_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "mortgage_payments_id_tenant_id_key" ON "mortgage_payments"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "heloc_credit_events_tenant_id_heloc_id_related_payment_peri_idx" ON "heloc_credit_events"("tenant_id", "heloc_id", "related_payment_period");

-- CreateIndex
CREATE UNIQUE INDEX "heloc_credit_events_tenant_id_provider_event_id_key" ON "heloc_credit_events"("tenant_id", "provider_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "heloc_credit_events_id_tenant_id_key" ON "heloc_credit_events"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "heloc_interest_charges_tenant_id_heloc_id_interest_period_idx" ON "heloc_interest_charges"("tenant_id", "heloc_id", "interest_period");

-- CreateIndex
CREATE UNIQUE INDEX "heloc_interest_charges_tenant_id_provider_charge_id_key" ON "heloc_interest_charges"("tenant_id", "provider_charge_id");

-- CreateIndex
CREATE UNIQUE INDEX "heloc_interest_charges_id_tenant_id_key" ON "heloc_interest_charges"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "heloc_interest_payments_charge_id_key" ON "heloc_interest_payments"("charge_id");

-- CreateIndex
CREATE INDEX "heloc_interest_payments_tenant_id_ordinary_bank_account_id_idx" ON "heloc_interest_payments"("tenant_id", "ordinary_bank_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "heloc_interest_payments_charge_id_tenant_id_key" ON "heloc_interest_payments"("charge_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "heloc_interest_payments_tenant_id_provider_payment_id_key" ON "heloc_interest_payments"("tenant_id", "provider_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "heloc_interest_payments_id_tenant_id_key" ON "heloc_interest_payments"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "monthly_conversion_cycles_tenant_id_strategy_id_state_idx" ON "monthly_conversion_cycles"("tenant_id", "strategy_id", "state");

-- CreateIndex
CREATE INDEX "monthly_conversion_cycles_tenant_id_correlation_id_idx" ON "monthly_conversion_cycles"("tenant_id", "correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_conversion_cycles_tenant_id_strategy_id_payment_per_key" ON "monthly_conversion_cycles"("tenant_id", "strategy_id", "payment_period");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_conversion_cycles_id_tenant_id_key" ON "monthly_conversion_cycles"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "money_movements_tenant_id_cycle_id_idx" ON "money_movements"("tenant_id", "cycle_id");

-- CreateIndex
CREATE INDEX "money_movements_tenant_id_state_idx" ON "money_movements"("tenant_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "money_movements_tenant_id_idempotency_key_key" ON "money_movements"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "money_movements_tenant_id_type_provider_transaction_id_key" ON "money_movements"("tenant_id", "type", "provider_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "money_movements_id_tenant_id_key" ON "money_movements"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "brokerage_deposits_money_movement_id_key" ON "brokerage_deposits"("money_movement_id");

-- CreateIndex
CREATE INDEX "brokerage_deposits_tenant_id_cycle_id_idx" ON "brokerage_deposits"("tenant_id", "cycle_id");

-- CreateIndex
CREATE UNIQUE INDEX "brokerage_deposits_money_movement_id_tenant_id_key" ON "brokerage_deposits"("money_movement_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "brokerage_deposits_tenant_id_provider_deposit_id_key" ON "brokerage_deposits"("tenant_id", "provider_deposit_id");

-- CreateIndex
CREATE UNIQUE INDEX "brokerage_deposits_id_tenant_id_key" ON "brokerage_deposits"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "investment_orders_tenant_id_cycle_id_idx" ON "investment_orders"("tenant_id", "cycle_id");

-- CreateIndex
CREATE INDEX "investment_orders_tenant_id_state_idx" ON "investment_orders"("tenant_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "investment_orders_tenant_id_idempotency_key_key" ON "investment_orders"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "investment_orders_tenant_id_provider_order_id_key" ON "investment_orders"("tenant_id", "provider_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "investment_orders_id_tenant_id_key" ON "investment_orders"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "investment_fills_tenant_id_order_id_idx" ON "investment_fills"("tenant_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "investment_fills_tenant_id_provider_fill_id_key" ON "investment_fills"("tenant_id", "provider_fill_id");

-- CreateIndex
CREATE UNIQUE INDEX "investment_fills_id_tenant_id_key" ON "investment_fills"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "ledger_entries_tenant_id_account_id_created_at_idx" ON "ledger_entries"("tenant_id", "account_id", "created_at");

-- CreateIndex
CREATE INDEX "ledger_entries_tenant_id_cycle_id_idx" ON "ledger_entries"("tenant_id", "cycle_id");

-- CreateIndex
CREATE INDEX "ledger_entries_tenant_id_correlation_id_idx" ON "ledger_entries"("tenant_id", "correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_tenant_id_business_event_id_key" ON "ledger_entries"("tenant_id", "business_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_id_tenant_id_key" ON "ledger_entries"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "reconciliations_tenant_id_strategy_id_idx" ON "reconciliations"("tenant_id", "strategy_id");

-- CreateIndex
CREATE INDEX "reconciliations_tenant_id_cycle_id_idx" ON "reconciliations"("tenant_id", "cycle_id");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliations_id_tenant_id_key" ON "reconciliations"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "reconciliation_items_tenant_id_reconciliation_id_idx" ON "reconciliation_items"("tenant_id", "reconciliation_id");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_items_id_tenant_id_key" ON "reconciliation_items"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "idempotency_records_tenant_id_scope_state_idx" ON "idempotency_records"("tenant_id", "scope", "state");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_tenant_id_scope_key_key" ON "idempotency_records"("tenant_id", "scope", "key");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_id_tenant_id_key" ON "idempotency_records"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "provider_webhook_events_tenant_id_provider_event_type_idx" ON "provider_webhook_events"("tenant_id", "provider", "event_type");

-- CreateIndex
CREATE UNIQUE INDEX "provider_webhook_events_tenant_id_provider_provider_event_i_key" ON "provider_webhook_events"("tenant_id", "provider", "provider_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_webhook_events_id_tenant_id_key" ON "provider_webhook_events"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "operational_exceptions_tenant_id_state_severity_idx" ON "operational_exceptions"("tenant_id", "state", "severity");

-- CreateIndex
CREATE INDEX "operational_exceptions_tenant_id_strategy_id_idx" ON "operational_exceptions"("tenant_id", "strategy_id");

-- CreateIndex
CREATE UNIQUE INDEX "operational_exceptions_id_tenant_id_key" ON "operational_exceptions"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "audit_documents_tenant_id_resource_type_resource_id_idx" ON "audit_documents"("tenant_id", "resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "audit_documents_tenant_id_created_at_idx" ON "audit_documents"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "audit_documents_id_tenant_id_key" ON "audit_documents"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "workflow_references_tenant_id_strategy_id_type_idx" ON "workflow_references"("tenant_id", "strategy_id", "type");

-- CreateIndex
CREATE INDEX "workflow_references_tenant_id_cycle_id_idx" ON "workflow_references"("tenant_id", "cycle_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_references_tenant_id_temporal_workflow_id_key" ON "workflow_references"("tenant_id", "temporal_workflow_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_references_id_tenant_id_key" ON "workflow_references"("id", "tenant_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_connections" ADD CONSTRAINT "financial_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_connections" ADD CONSTRAINT "financial_connections_user_id_tenant_id_fkey" FOREIGN KEY ("user_id", "tenant_id") REFERENCES "users"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_user_id_tenant_id_fkey" FOREIGN KEY ("user_id", "tenant_id") REFERENCES "users"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_connection_id_tenant_id_fkey" FOREIGN KEY ("connection_id", "tenant_id") REFERENCES "financial_connections"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mortgages" ADD CONSTRAINT "mortgages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mortgages" ADD CONSTRAINT "mortgages_account_id_tenant_id_fkey" FOREIGN KEY ("account_id", "tenant_id") REFERENCES "financial_accounts"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helocs" ADD CONSTRAINT "helocs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helocs" ADD CONSTRAINT "helocs_account_id_tenant_id_fkey" FOREIGN KEY ("account_id", "tenant_id") REFERENCES "financial_accounts"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brokerage_accounts" ADD CONSTRAINT "brokerage_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brokerage_accounts" ADD CONSTRAINT "brokerage_accounts_account_id_tenant_id_fkey" FOREIGN KEY ("account_id", "tenant_id") REFERENCES "financial_accounts"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordinary_bank_accounts" ADD CONSTRAINT "ordinary_bank_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordinary_bank_accounts" ADD CONSTRAINT "ordinary_bank_accounts_account_id_tenant_id_fkey" FOREIGN KEY ("account_id", "tenant_id") REFERENCES "financial_accounts"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_user_id_tenant_id_fkey" FOREIGN KEY ("user_id", "tenant_id") REFERENCES "users"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_mortgage_account_id_tenant_id_user_id_fkey" FOREIGN KEY ("mortgage_account_id", "tenant_id", "user_id") REFERENCES "financial_accounts"("id", "tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_heloc_account_id_tenant_id_user_id_fkey" FOREIGN KEY ("heloc_account_id", "tenant_id", "user_id") REFERENCES "financial_accounts"("id", "tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_bank_account_id_tenant_id_user_id_fkey" FOREIGN KEY ("bank_account_id", "tenant_id", "user_id") REFERENCES "financial_accounts"("id", "tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_brokerage_account_id_tenant_id_user_id_fkey" FOREIGN KEY ("brokerage_account_id", "tenant_id", "user_id") REFERENCES "financial_accounts"("id", "tenant_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_investment_policies" ADD CONSTRAINT "strategy_investment_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_investment_policies" ADD CONSTRAINT "strategy_investment_policies_strategy_id_tenant_id_fkey" FOREIGN KEY ("strategy_id", "tenant_id") REFERENCES "strategies"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mortgage_payments" ADD CONSTRAINT "mortgage_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mortgage_payments" ADD CONSTRAINT "mortgage_payments_mortgage_id_tenant_id_fkey" FOREIGN KEY ("mortgage_id", "tenant_id") REFERENCES "mortgages"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "heloc_credit_events" ADD CONSTRAINT "heloc_credit_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "heloc_credit_events" ADD CONSTRAINT "heloc_credit_events_heloc_id_tenant_id_fkey" FOREIGN KEY ("heloc_id", "tenant_id") REFERENCES "helocs"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "heloc_interest_charges" ADD CONSTRAINT "heloc_interest_charges_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "heloc_interest_charges" ADD CONSTRAINT "heloc_interest_charges_heloc_id_tenant_id_fkey" FOREIGN KEY ("heloc_id", "tenant_id") REFERENCES "helocs"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "heloc_interest_payments" ADD CONSTRAINT "heloc_interest_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "heloc_interest_payments" ADD CONSTRAINT "heloc_interest_payments_charge_id_tenant_id_fkey" FOREIGN KEY ("charge_id", "tenant_id") REFERENCES "heloc_interest_charges"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "heloc_interest_payments" ADD CONSTRAINT "heloc_interest_payments_ordinary_bank_account_id_tenant_id_fkey" FOREIGN KEY ("ordinary_bank_account_id", "tenant_id") REFERENCES "ordinary_bank_accounts"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_conversion_cycles" ADD CONSTRAINT "monthly_conversion_cycles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_conversion_cycles" ADD CONSTRAINT "monthly_conversion_cycles_strategy_id_tenant_id_fkey" FOREIGN KEY ("strategy_id", "tenant_id") REFERENCES "strategies"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_conversion_cycles" ADD CONSTRAINT "monthly_conversion_cycles_mortgage_payment_id_tenant_id_fkey" FOREIGN KEY ("mortgage_payment_id", "tenant_id") REFERENCES "mortgage_payments"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_movements" ADD CONSTRAINT "money_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_movements" ADD CONSTRAINT "money_movements_cycle_id_tenant_id_fkey" FOREIGN KEY ("cycle_id", "tenant_id") REFERENCES "monthly_conversion_cycles"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brokerage_deposits" ADD CONSTRAINT "brokerage_deposits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brokerage_deposits" ADD CONSTRAINT "brokerage_deposits_cycle_id_tenant_id_fkey" FOREIGN KEY ("cycle_id", "tenant_id") REFERENCES "monthly_conversion_cycles"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brokerage_deposits" ADD CONSTRAINT "brokerage_deposits_brokerage_account_id_tenant_id_fkey" FOREIGN KEY ("brokerage_account_id", "tenant_id") REFERENCES "brokerage_accounts"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brokerage_deposits" ADD CONSTRAINT "brokerage_deposits_money_movement_id_tenant_id_fkey" FOREIGN KEY ("money_movement_id", "tenant_id") REFERENCES "money_movements"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_orders" ADD CONSTRAINT "investment_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_orders" ADD CONSTRAINT "investment_orders_cycle_id_tenant_id_fkey" FOREIGN KEY ("cycle_id", "tenant_id") REFERENCES "monthly_conversion_cycles"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_orders" ADD CONSTRAINT "investment_orders_brokerage_account_id_tenant_id_fkey" FOREIGN KEY ("brokerage_account_id", "tenant_id") REFERENCES "brokerage_accounts"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_fills" ADD CONSTRAINT "investment_fills_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_fills" ADD CONSTRAINT "investment_fills_order_id_tenant_id_fkey" FOREIGN KEY ("order_id", "tenant_id") REFERENCES "investment_orders"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_tenant_id_fkey" FOREIGN KEY ("account_id", "tenant_id") REFERENCES "financial_accounts"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_cycle_id_tenant_id_fkey" FOREIGN KEY ("cycle_id", "tenant_id") REFERENCES "monthly_conversion_cycles"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_strategy_id_tenant_id_fkey" FOREIGN KEY ("strategy_id", "tenant_id") REFERENCES "strategies"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_cycle_id_tenant_id_fkey" FOREIGN KEY ("cycle_id", "tenant_id") REFERENCES "monthly_conversion_cycles"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_reconciliation_id_tenant_id_fkey" FOREIGN KEY ("reconciliation_id", "tenant_id") REFERENCES "reconciliations"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_webhook_events" ADD CONSTRAINT "provider_webhook_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_exceptions" ADD CONSTRAINT "operational_exceptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_documents" ADD CONSTRAINT "audit_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_references" ADD CONSTRAINT "workflow_references_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_references" ADD CONSTRAINT "workflow_references_strategy_id_tenant_id_fkey" FOREIGN KEY ("strategy_id", "tenant_id") REFERENCES "strategies"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_references" ADD CONSTRAINT "workflow_references_cycle_id_tenant_id_fkey" FOREIGN KEY ("cycle_id", "tenant_id") REFERENCES "monthly_conversion_cycles"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

