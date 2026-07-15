import {
  AppError,
  toCustomerCycleStatus,
  type MonthlyConversionCycleState,
  type TenantContext,
} from '@csm/contracts';
import type { PrismaClient, Repositories } from '@csm/database';

import { requireRoles } from '../auth/guards.js';
import { serializeCycle, serializeMoney } from '../lib/serialize.js';
import type { StrategyAppService } from './strategy-app-service.js';

function temporalUiLink(
  baseUrl: string,
  namespace: string,
  workflowId: string,
  runId?: string | null,
): string {
  const path = runId
    ? `/namespaces/${encodeURIComponent(namespace)}/workflows/${encodeURIComponent(workflowId)}/${encodeURIComponent(runId)}/history`
    : `/namespaces/${encodeURIComponent(namespace)}/workflows/${encodeURIComponent(workflowId)}`;
  return new URL(path, baseUrl).toString();
}

export class OperationsAppService {
  constructor(
    private readonly repos: Repositories,
    private readonly prisma: PrismaClient,
    private readonly strategies: StrategyAppService,
    private readonly temporalUiBaseUrl: string,
  ) {}

  async listExceptions(auth: TenantContext, correlationId: string) {
    requireRoles(auth, ['OPERATIONS'], correlationId);
    const rows = await this.repos.exceptions.listOpen(auth.tenantId);
    return rows.map((e) => ({
      id: e.id,
      tenantId: e.tenantId,
      strategyId: e.strategyId,
      cycleId: e.cycleId,
      code: e.code,
      severity: e.severity,
      state: e.state,
      message: e.message,
      details: e.details,
      correlationId: e.correlationId,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
      version: e.version,
    }));
  }

  async listCycles(auth: TenantContext, correlationId: string) {
    requireRoles(auth, ['OPERATIONS'], correlationId);
    const cycles = await this.prisma.monthlyConversionCycle.findMany({
      where: { tenantId: auth.tenantId },
      orderBy: [{ paymentPeriod: 'desc' }, { updatedAt: 'desc' }],
      take: 100,
    });
    return cycles.map((c) => ({
      ...serializeCycle(c),
      customerStatus: toCustomerCycleStatus(c.state as MonthlyConversionCycleState),
    }));
  }

  async getCycle(auth: TenantContext, cycleId: string, correlationId: string) {
    requireRoles(auth, ['OPERATIONS'], correlationId);
    const cycle = await this.repos.cycles.findById(auth.tenantId, cycleId);
    if (!cycle) {
      throw new AppError({ code: 'NOT_FOUND', message: 'Cycle not found', correlationId });
    }
    const exceptions = await this.repos.exceptions.findByCycle(auth.tenantId, cycleId);
    const workflows = await this.prisma.workflowReference.findMany({
      where: { tenantId: auth.tenantId, cycleId },
      orderBy: { createdAt: 'desc' },
    });
    const reconciliation = await this.repos.reconciliations.findByCycle(auth.tenantId, cycleId);
    const reconciliationItems = reconciliation
      ? await this.prisma.reconciliationItem.findMany({
          where: { tenantId: auth.tenantId, reconciliationId: reconciliation.id },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    const moneyMovements = await this.prisma.moneyMovement.findMany({
      where: { tenantId: auth.tenantId, cycleId },
      orderBy: { createdAt: 'asc' },
    });
    const orders = await this.prisma.investmentOrder.findMany({
      where: { tenantId: auth.tenantId, cycleId },
      orderBy: { createdAt: 'asc' },
    });
    const webhooks = await this.prisma.providerWebhookEvent.findMany({
      where: {
        tenantId: auth.tenantId,
        OR: [{ paymentPeriod: cycle.paymentPeriod }, { strategyId: cycle.strategyId }],
      },
      orderBy: { receivedAt: 'desc' },
      take: 50,
    });

    return {
      cycle: {
        ...serializeCycle(cycle),
        customerStatus: toCustomerCycleStatus(cycle.state as MonthlyConversionCycleState),
      },
      exceptions: exceptions.map((e) => ({
        id: e.id,
        code: e.code,
        severity: e.severity,
        state: e.state,
        message: e.message,
        details: e.details,
        correlationId: e.correlationId,
        createdAt: e.createdAt.toISOString(),
      })),
      activityAttempts: [
        ...moneyMovements.map((m) => ({
          kind: 'money_movement' as const,
          id: m.id,
          type: m.type,
          state: m.state,
          amountCents: serializeMoney(m.amountCents),
          providerTransactionId: m.providerTransactionId,
          failureCode: m.failureCode,
          idempotencyKey: m.idempotencyKey,
          requestedAt: m.requestedAt.toISOString(),
          settledAt: m.settledAt?.toISOString() ?? null,
        })),
        ...orders.map((o) => ({
          kind: 'investment_order' as const,
          id: o.id,
          type: o.side,
          state: o.state,
          amountCents: serializeMoney(o.notionalCents),
          providerOrderId: o.providerOrderId,
          symbol: o.symbol,
          idempotencyKey: o.idempotencyKey,
          submittedAt: o.submittedAt?.toISOString() ?? null,
          filledAt: o.filledAt?.toISOString() ?? null,
        })),
      ],
      reconciliation: reconciliation
        ? {
            id: reconciliation.id,
            state: reconciliation.state,
            kind: reconciliation.kind,
            summary: reconciliation.summary,
            completedAt: reconciliation.completedAt?.toISOString() ?? null,
            items: reconciliationItems.map((i) => ({
              id: i.id,
              code: i.code,
              result: i.result,
              expectedValue: i.expectedValue,
              actualValue: i.actualValue,
              detail: i.detail,
            })),
          }
        : null,
      webhooks: webhooks.map((w) => this.serializeWebhook(w)),
      workflows: workflows.map((w) => ({
        id: w.id,
        type: w.type,
        temporalWorkflowId: w.temporalWorkflowId,
        temporalRunId: w.temporalRunId,
        temporalNamespace: w.temporalNamespace,
        temporalUiUrl: temporalUiLink(
          this.temporalUiBaseUrl,
          w.temporalNamespace,
          w.temporalWorkflowId,
          w.temporalRunId,
        ),
        createdAt: w.createdAt.toISOString(),
      })),
      safeActions: {
        canResumeStrategy: true,
        canRetryDeadLetterWebhooks: webhooks.some((w) => w.processingState === 'DEAD_LETTERED'),
      },
    };
  }

  async resumeStrategy(
    auth: TenantContext,
    strategyId: string,
    clearanceNote: string,
    correlationId: string,
  ) {
    requireRoles(auth, ['OPERATIONS'], correlationId);
    return this.strategies.resume(auth, strategyId, clearanceNote, correlationId);
  }

  async listWebhooks(auth: TenantContext, correlationId: string) {
    requireRoles(auth, ['OPERATIONS'], correlationId);
    const rows = await this.prisma.providerWebhookEvent.findMany({
      where: { tenantId: auth.tenantId },
      orderBy: { receivedAt: 'desc' },
      take: 100,
    });
    return rows.map((w) => this.serializeWebhook(w));
  }

  async retryWebhook(auth: TenantContext, webhookId: string, correlationId: string) {
    requireRoles(auth, ['OPERATIONS'], correlationId);
    const row = await this.repos.webhooks.findById(auth.tenantId, webhookId);
    if (!row) {
      throw new AppError({ code: 'NOT_FOUND', message: 'Webhook not found', correlationId });
    }
    if (!['DEAD_LETTERED', 'RETAINED', 'RETRYABLE'].includes(row.processingState)) {
      throw new AppError({
        code: 'CONFLICT',
        message: 'Webhook is not eligible for safe retry',
        correlationId,
      });
    }
    const updated = await this.prisma.providerWebhookEvent.update({
      where: { id: row.id },
      data: {
        processingState: 'RECEIVED',
        nextAttemptAt: new Date(),
        lastError: null,
        deadLetterReason: null,
        outcome: null,
      },
    });
    return this.serializeWebhook(updated);
  }

  async listReconciliations(auth: TenantContext, correlationId: string) {
    requireRoles(auth, ['OPERATIONS'], correlationId);
    const rows = await this.prisma.reconciliation.findMany({
      where: { tenantId: auth.tenantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    const daily = await this.repos.dailyReconciliationReports.listForTenant(auth.tenantId);
    return {
      reconciliations: rows.map((r) => ({
        id: r.id,
        strategyId: r.strategyId,
        cycleId: r.cycleId,
        interestCycleId: r.interestCycleId,
        kind: r.kind,
        state: r.state,
        summary: r.summary,
        correlationId: r.correlationId,
        completedAt: r.completedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        items: r.items.map((i) => ({
          id: i.id,
          code: i.code,
          result: i.result,
          expectedValue: i.expectedValue,
          actualValue: i.actualValue,
          detail: i.detail,
        })),
      })),
      dailyReports: daily.slice(0, 30).map((d) => ({
        id: d.id,
        reportDate: d.reportDate.toISOString().slice(0, 10),
        conversionPassedCount: d.conversionPassedCount,
        conversionFailedCount: d.conversionFailedCount,
        interestPassedCount: d.interestPassedCount,
        interestFailedCount: d.interestFailedCount,
        ledgerDebitCents: serializeMoney(d.ledgerDebitCents),
        ledgerCreditCents: serializeMoney(d.ledgerCreditCents),
        ledgerBalanced: d.ledgerBalanced,
      })),
    };
  }

  async listWorkflows(auth: TenantContext, correlationId: string) {
    requireRoles(auth, ['OPERATIONS'], correlationId);
    const rows = await this.prisma.workflowReference.findMany({
      where: { tenantId: auth.tenantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((w) => ({
      id: w.id,
      strategyId: w.strategyId,
      cycleId: w.cycleId,
      type: w.type,
      temporalWorkflowId: w.temporalWorkflowId,
      temporalRunId: w.temporalRunId,
      temporalNamespace: w.temporalNamespace,
      temporalUiUrl: temporalUiLink(
        this.temporalUiBaseUrl,
        w.temporalNamespace,
        w.temporalWorkflowId,
        w.temporalRunId,
      ),
      createdAt: w.createdAt.toISOString(),
      updatedAt: w.updatedAt.toISOString(),
    }));
  }

  async listDocuments(auth: TenantContext, correlationId: string) {
    requireRoles(auth, ['CUSTOMER', 'OPERATIONS'], correlationId);
    const where =
      auth.roles.includes('OPERATIONS') || auth.roles.includes('ADMIN')
        ? { tenantId: auth.tenantId }
        : {
            tenantId: auth.tenantId,
            OR: [{ actorId: auth.userId }, { actorType: 'SYSTEM' as const }],
          };
    const rows = await this.prisma.auditDocument.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((d) => ({
      id: d.id,
      actorType: d.actorType,
      actorId: d.actorId,
      action: d.action,
      resourceType: d.resourceType,
      resourceId: d.resourceId,
      correlationId: d.correlationId,
      payloadRedacted: d.payloadRedacted,
      createdAt: d.createdAt.toISOString(),
    }));
  }

  async listInterestPayments(auth: TenantContext, strategyId: string, correlationId: string) {
    requireRoles(auth, ['CUSTOMER', 'OPERATIONS'], correlationId);
    const strategy = await this.repos.strategies.findById(auth.tenantId, strategyId);
    if (!strategy) {
      throw new AppError({ code: 'NOT_FOUND', message: 'Strategy not found', correlationId });
    }
    if (
      !auth.roles.includes('ADMIN') &&
      !auth.roles.includes('OPERATIONS') &&
      strategy.userId !== auth.userId
    ) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Forbidden', correlationId });
    }
    const ordinary = await this.repos.accounts.findOrdinaryBankDetail(
      auth.tenantId,
      strategy.bankAccountId,
    );
    if (!ordinary) {
      return [];
    }
    const rows = await this.prisma.helocInterestPayment.findMany({
      where: { tenantId: auth.tenantId, ordinaryBankAccountId: ordinary.id },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((p) => ({
      id: p.id,
      chargeId: p.chargeId,
      amountCents: serializeMoney(p.amountCents),
      state: p.state,
      providerPaymentId: p.providerPaymentId,
      providerDebitId: p.providerDebitId,
      failureCode: p.failureCode,
      settledAt: p.settledAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
    }));
  }

  async listDevScenarios(correlationId: string) {
    void correlationId;
    const tenants = await this.prisma.tenant.findMany({
      orderBy: { slug: 'asc' },
      include: { users: { orderBy: { email: 'asc' } } },
    });
    return tenants.map((t) => ({
      tenantId: t.id,
      slug: t.slug,
      name: t.name,
      users: t.users.map((u) => ({
        userId: u.id,
        email: u.email,
        displayName: u.displayName,
      })),
    }));
  }

  private serializeWebhook(w: {
    id: string;
    tenantId: string;
    provider: string;
    providerEventId: string;
    eventType: string;
    processingState: string;
    attempts: number;
    nextAttemptAt: Date | null;
    lastError: string | null;
    deadLetterReason: string | null;
    financialAccountId: string | null;
    strategyId: string | null;
    paymentPeriod: string | null;
    outcome: string | null;
    receivedAt: Date;
    processedAt: Date | null;
  }) {
    return {
      id: w.id,
      tenantId: w.tenantId,
      provider: w.provider,
      providerEventId: w.providerEventId,
      eventType: w.eventType,
      processingState: w.processingState,
      attempts: w.attempts,
      nextAttemptAt: w.nextAttemptAt?.toISOString() ?? null,
      lastError: w.lastError,
      deadLetterReason: w.deadLetterReason,
      financialAccountId: w.financialAccountId,
      strategyId: w.strategyId,
      paymentPeriod: w.paymentPeriod,
      outcome: w.outcome,
      receivedAt: w.receivedAt.toISOString(),
      processedAt: w.processedAt?.toISOString() ?? null,
    };
  }
}
