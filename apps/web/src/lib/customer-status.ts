import { toCustomerCycleStatus, type CustomerCycleStatus } from '@csm/contracts';

export type { CustomerCycleStatus };

export function mapInternalCycleState(state: string): CustomerCycleStatus {
  return toCustomerCycleStatus(state as Parameters<typeof toCustomerCycleStatus>[0]);
}

export function automationLabel(state: string): string {
  switch (state) {
    case 'ACTIVE':
      return 'Automation active';
    case 'PAUSED':
      return 'Automation paused';
    case 'DRAFT':
      return 'Draft — not activated';
    case 'CLOSED':
      return 'Closed';
    default:
      return state;
  }
}
