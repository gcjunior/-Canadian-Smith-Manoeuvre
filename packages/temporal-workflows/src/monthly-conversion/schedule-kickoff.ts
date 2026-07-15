import { ParentClosePolicy, startChild, uuid4, workflowInfo } from '@temporalio/workflow';

import { correlationIdFromMemo } from '../shared/correlation.js';
import { deriveAnchorsFromCheckInstant } from './schedule-anchors.js';
import { monthlyConversionWorkflowId } from './types.js';
import { monthlyConversionWorkflow } from './workflow.js';

export interface MonthlyConversionScheduleKickoffInput {
  tenantId: string;
  strategyId: string;
  timezone: string;
  expectedPaymentDay: number;
  simulatorScenarioId?: string;
}

/**
 * Short-lived Schedule Action: derive paymentPeriod from Temporal time, then
 * start the deterministic MonthlyConversionWorkflow as an abandoned child.
 */
export async function monthlyConversionScheduleKickoff(
  input: MonthlyConversionScheduleKickoffInput,
): Promise<{ conversionWorkflowId: string; paymentPeriod: string; correlationId: string }> {
  const anchors = deriveAnchorsFromCheckInstant({
    instant: workflowInfo().runStartTime,
    timeZone: input.timezone,
    expectedPaymentDay: input.expectedPaymentDay,
  });

  const conversionWorkflowId = monthlyConversionWorkflowId({
    tenantId: input.tenantId,
    strategyId: input.strategyId,
    paymentPeriod: anchors.paymentPeriod,
  });

  const correlationId = correlationIdFromMemo(workflowInfo().memo) ?? uuid4();

  try {
    await startChild(monthlyConversionWorkflow, {
      workflowId: conversionWorkflowId,
      memo: { correlationId, tenantId: input.tenantId, strategyId: input.strategyId },
      args: [
        {
          tenantId: input.tenantId,
          strategyId: input.strategyId,
          paymentPeriod: anchors.paymentPeriod,
          expectedPaymentDate: anchors.expectedPaymentDate,
          timezone: input.timezone,
          correlationId,
          ...(input.simulatorScenarioId ? { simulatorScenarioId: input.simulatorScenarioId } : {}),
        },
      ],
      parentClosePolicy: ParentClosePolicy.ABANDON,
    });
  } catch (error) {
    // Duplicate Schedule trigger / overlap recovery: same period already running.
    if (isAlreadyStarted(error)) {
      return {
        conversionWorkflowId,
        paymentPeriod: anchors.paymentPeriod,
        correlationId,
      };
    }
    throw error;
  }

  return {
    conversionWorkflowId,
    paymentPeriod: anchors.paymentPeriod,
    correlationId,
  };
}

function isAlreadyStarted(error: unknown): boolean {
  const name =
    error && typeof error === 'object' && 'name' in error
      ? String((error as { name: unknown }).name)
      : '';
  const message = error instanceof Error ? error.message : String(error);
  return (
    name.includes('WorkflowExecutionAlreadyStarted') ||
    message.includes('WorkflowExecutionAlreadyStarted') ||
    message.includes('already started')
  );
}
