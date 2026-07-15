/**
 * Activity surface used by MonthlyConversionWorkflow.
 * Implemented by `@csm/temporal-activities` createActivities — typed here so the
 * Workflow bundle never imports Activity implementations.
 */
export interface MonthlyConversionActivities {
  loadStrategySnapshot(ctx: ActivityCtx): Promise<{
    strategyId: string;
    tenantId: string;
    state: string;
    timezone: string;
    userMonthlyCapCents: string;
    symbol: string;
    mortgageAccountId: string;
    helocAccountId: string;
    bankAccountId: string;
    brokerageAccountId: string;
    allowFractionalShares: boolean;
  }>;

  reserveMonthlyCycle(ctx: ActivityCtx & { paymentPeriod: string }): Promise<{
    cycleId: string;
    state: string;
    paymentPeriod: string;
    created: boolean;
  }>;

  transitionCycleState(
    ctx: ActivityCtx & { fromState: string; toState: string },
  ): Promise<{ cycleId: string; state: string }>;

  findSettledMortgagePayment(ctx: ActivityCtx): Promise<{
    mortgagePaymentId: string;
    providerPaymentId: string;
    principalAmountCents: string;
    interestAmountCents: string;
    totalAmountCents: string;
    paymentPeriod: string;
    state: string;
  }>;

  identifyPrincipalRepaid(
    ctx: ActivityCtx & { mortgagePaymentId: string },
  ): Promise<{ principalRepaidCents: string }>;

  verifyPaymentNotReversed(
    ctx: ActivityCtx & { providerPaymentId: string },
  ): Promise<{ ok: true; state: string }>;

  getHelocAvailability(ctx: ActivityCtx): Promise<{
    availableCreditCents: string;
    existingAvailableCreditCents: string;
    newlyAvailableCreditCents: string;
    stale: boolean;
    observedAt: string;
  }>;

  calculateNewlyAvailableCredit(
    ctx: ActivityCtx & { principalRepaidCents: string },
  ): Promise<{ newlyAvailableCreditCents: string; drawAmountCents: string }>;

  initiateHelocDraw(ctx: ActivityCtx & { amountCents: string; idempotencyKey: string }): Promise<{
    moneyMovementId: string;
    providerDrawId: string;
    state: string;
    amountCents: string;
  }>;

  resolveAmbiguousHelocDraw(
    ctx: ActivityCtx & { idempotencyKey: string },
  ): Promise<{ moneyMovementId: string; providerDrawId: string; state: string }>;

  confirmHelocDraw(
    ctx: ActivityCtx & { providerDrawId: string; idempotencyKey: string },
  ): Promise<{ state: string; settledAt: string | null }>;

  initiateBrokerageTransfer(
    ctx: ActivityCtx & { amountCents: string; idempotencyKey: string },
  ): Promise<{
    moneyMovementId: string;
    providerTransferId: string;
    depositMoneyMovementId: string;
    providerDepositId: string;
    state: string;
    amountCents: string;
  }>;

  resolveAmbiguousBrokerageTransfer(ctx: ActivityCtx & { idempotencyKey: string }): Promise<{
    moneyMovementId: string;
    providerTransferId: string;
    depositMoneyMovementId: string | null;
    providerDepositId: string | null;
    transferState: string;
    depositState: string | null;
  }>;

  confirmBrokerageTransfer(
    ctx: ActivityCtx & {
      idempotencyKey: string;
      providerTransferId: string;
      providerDepositId: string;
    },
  ): Promise<{ transferState: string; depositState: string }>;

  submitInvestmentOrder(
    ctx: ActivityCtx & { notionalCents: string; idempotencyKey: string },
  ): Promise<{
    investmentOrderId: string;
    providerOrderId: string;
    state: string;
    symbol: string;
    notionalCents: string;
  }>;

  resolveAmbiguousInvestmentOrder(
    ctx: ActivityCtx & { idempotencyKey: string },
  ): Promise<{ investmentOrderId: string; providerOrderId: string; state: string }>;

  confirmInvestmentOrder(
    ctx: ActivityCtx & { idempotencyKey: string; providerOrderId: string },
  ): Promise<{ state: string; filledQuantity: string; filledAt: string | null }>;

  confirmInvestmentSettlement(
    ctx: ActivityCtx & { idempotencyKey: string; expectedNotionalCents: string },
  ): Promise<{ settled: true; settledCashCents: string; symbol: string }>;

  reconcileCycle(ctx: ActivityCtx): Promise<{
    reconciliationId: string;
    state: 'PASSED' | 'FAILED';
    summary: string;
  }>;

  appendLedgerEntries(
    ctx: ActivityCtx & {
      entries: Array<{
        accountId: string;
        businessEventId: string;
        direction: 'DEBIT' | 'CREDIT';
        amountCents: string;
        narrative: string;
        cycleId?: string;
        interestCycleId?: string;
        currencyCode?: string;
        accountCategory?: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE' | 'CLEARING';
        strategyId?: string;
        providerRefType?: string;
        providerRefId?: string;
        reversesBusinessEventId?: string;
      }>;
    },
  ): Promise<{ entryIds: string[]; createdCount: number; skippedCount: number }>;

  completeCycle(ctx: ActivityCtx): Promise<{ cycleId: string; state: 'COMPLETED' }>;

  skipCycle(
    ctx: ActivityCtx & { reasonCode: string; reason: string },
  ): Promise<{ cycleId: string; state: 'SKIPPED' }>;

  pauseStrategyWithException(
    ctx: ActivityCtx & {
      code: string;
      message: string;
      details?: Record<string, unknown>;
      cycleTerminalState?: 'PAUSED' | 'FAILED';
    },
  ): Promise<{ strategyId: string; state: 'PAUSED'; exceptionId: string }>;

  createAuditPackageMetadata(
    ctx: ActivityCtx & { packageType: string; metadata: Record<string, unknown> },
  ): Promise<{ auditDocumentId: string }>;

  recordOperation(
    ctx: ActivityCtx & {
      operationKey: string;
      operationType: string;
      payload: Record<string, unknown>;
    },
  ): Promise<{ recorded: true; operationKey: string; auditId: string }>;
}

export interface ActivityCtx {
  tenantId: string;
  strategyId: string;
  cycleId?: string;
  correlationId: string;
  paymentPeriod?: string;
}
