export interface ActivityContext {
  tenantId: string;
  strategyId: string;
  cycleId?: string;
  correlationId: string;
  paymentPeriod?: string;
  interestPeriod?: string;
}

export function activityLogFields(ctx: ActivityContext): Record<string, string | undefined> {
  return {
    tenantId: ctx.tenantId,
    strategyId: ctx.strategyId,
    cycleId: ctx.cycleId,
    correlationId: ctx.correlationId,
    paymentPeriod: ctx.paymentPeriod,
    interestPeriod: ctx.interestPeriod,
  };
}
