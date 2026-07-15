/**
 * Activity surface used by HelocInterestPaymentWorkflow.
 * Implemented by `@csm/temporal-activities` createActivities — typed here so the
 * Workflow bundle never imports Activity implementations.
 */
export interface HelocInterestActivities {
  loadStrategySnapshot(ctx: ActivityCtx): Promise<{
    strategyId: string;
    tenantId: string;
    state: string;
    timezone: string;
    helocAccountId: string;
    bankAccountId: string;
    brokerageAccountId: string;
  }>;

  reserveInterestCycle(ctx: ActivityCtx & { interestPeriod: string }): Promise<{
    cycleId: string;
    state: string;
    interestPeriod: string;
    created: boolean;
  }>;

  transitionInterestCycleState(
    ctx: ActivityCtx & { fromState: string; toState: string },
  ): Promise<{ cycleId: string; state: string }>;

  /**
   * Persist/return a POSTED (or SETTLED) HELOC interest charge for the period.
   * Throws NOT_FOUND when no qualifying charge exists yet.
   */
  findPostedInterestCharge(ctx: ActivityCtx): Promise<{
    chargeId: string;
    providerChargeId: string;
    amountCents: string;
    state: string;
    interestPeriod: string;
  }>;

  /**
   * Locate the ordinary-bank debit for the charge/period.
   * Throws NOT_FOUND when no debit is visible yet.
   */
  findOrdinaryInterestDebit(
    ctx: ActivityCtx & { chargeId: string; providerChargeId: string },
  ): Promise<{
    debitId: string;
    paymentId: string;
    providerPaymentId?: string;
    amountCents: string;
    state: string;
    ordinaryAccountId: string;
    failureCode?: string | null;
  }>;

  /** Throws non-retryable on FAILED / REVERSED (incl. NSF). */
  confirmInterestDebitSettlement(
    ctx: ActivityCtx & { debitId: string; paymentId: string },
  ): Promise<{ state: 'SETTLED'; settledAt: string | null }>;

  validateInterestPaymentRules(
    ctx: ActivityCtx & {
      chargeId: string;
      debitId: string;
      chargeAmountCents: string;
      debitAmountCents: string;
      ordinaryAccountId: string;
    },
  ): Promise<{ ok: true }>;

  reconcileInterestCycle(ctx: ActivityCtx): Promise<{
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

  completeInterestCycle(ctx: ActivityCtx): Promise<{ cycleId: string; state: 'COMPLETED' }>;

  /**
   * Terminal interest-cycle failure: set cycle PAUSED/FAILED, create exception,
   * pause strategy (default policy also pauses future conversions).
   */
  failInterestCycle(
    ctx: ActivityCtx & {
      code: string;
      message: string;
      details?: Record<string, unknown>;
      terminalState?: 'PAUSED' | 'FAILED';
    },
  ): Promise<{
    strategyId: string;
    state: 'PAUSED';
    exceptionId: string;
    cycleId: string;
  }>;

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
  interestPeriod?: string;
}
