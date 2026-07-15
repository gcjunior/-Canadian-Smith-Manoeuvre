-- CreateTable
CREATE TABLE "strategy_schedules" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "strategy_id" UUID NOT NULL,
    "temporal_schedule_id" TEXT NOT NULL,
    "temporal_namespace" TEXT NOT NULL DEFAULT 'default',
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL,
    "expected_payment_day" INTEGER NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "strategy_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "strategy_schedules_tenant_id_strategy_id_key" ON "strategy_schedules"("tenant_id", "strategy_id");

-- CreateIndex
CREATE UNIQUE INDEX "strategy_schedules_tenant_id_temporal_schedule_id_key" ON "strategy_schedules"("tenant_id", "temporal_schedule_id");

-- CreateIndex
CREATE UNIQUE INDEX "strategy_schedules_id_tenant_id_key" ON "strategy_schedules"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "strategy_schedules_tenant_id_paused_idx" ON "strategy_schedules"("tenant_id", "paused");

-- AddForeignKey
ALTER TABLE "strategy_schedules" ADD CONSTRAINT "strategy_schedules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_schedules" ADD CONSTRAINT "strategy_schedules_strategy_id_tenant_id_fkey" FOREIGN KEY ("strategy_id", "tenant_id") REFERENCES "strategies"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;
