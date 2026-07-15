import { ParentClosePolicy, startChild, uuid4, workflowInfo } from '@temporalio/workflow';

import { correlationIdFromMemo } from '../shared/correlation.js';
import { deriveInterestAnchorsFromCheckInstant } from './schedule-anchors.js';
import { helocInterestWorkflowId } from './types.js';
import { helocInterestPaymentWorkflow } from './workflow.js';

export interface HelocInterestScheduleKickoffInput {
  tenantId: string;
  strategyId: string;
  timezone: string;
  expectedInterestChargeDay: number;
  simulatorScenarioId?: string;
}

/**
 * Short-lived Schedule Action: derive interestPeriod from Temporal time, then
 * start the deterministic HelocInterestPaymentWorkflow as an abandoned child.
 */
export async function helocInterestScheduleKickoff(
  input: HelocInterestScheduleKickoffInput,
): Promise<{ interestWorkflowId: string; interestPeriod: string; correlationId: string }> {
  const anchors = deriveInterestAnchorsFromCheckInstant({
    instant: workflowInfo().runStartTime,
    timeZone: input.timezone,
    expectedInterestChargeDay: input.expectedInterestChargeDay,
  });

  const interestWorkflowId = helocInterestWorkflowId({
    tenantId: input.tenantId,
    strategyId: input.strategyId,
    interestPeriod: anchors.interestPeriod,
  });

  const correlationId = correlationIdFromMemo(workflowInfo().memo) ?? uuid4();

  try {
    await startChild(helocInterestPaymentWorkflow, {
      workflowId: interestWorkflowId,
      memo: { correlationId, tenantId: input.tenantId, strategyId: input.strategyId },
      args: [
        {
          tenantId: input.tenantId,
          strategyId: input.strategyId,
          interestPeriod: anchors.interestPeriod,
          expectedInterestChargeDate: anchors.expectedInterestChargeDate,
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
        interestWorkflowId,
        interestPeriod: anchors.interestPeriod,
        correlationId,
      };
    }
    throw error;
  }

  return {
    interestWorkflowId,
    interestPeriod: anchors.interestPeriod,
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
