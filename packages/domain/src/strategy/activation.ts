import { DomainError } from '../errors.js';
import { assertStrategyAccountBindings, type AccountRef } from './account-validation.js';
import { asCanadianTimezone } from '../value-objects/timezone.js';

export interface ActivationAccountBundle {
  mortgage: AccountRef;
  heloc: AccountRef;
  bankOperating: AccountRef;
  brokerageCash: AccountRef;
  brokerageRegistrationType: 'NON_REGISTERED' | 'TFSA' | 'RRSP' | 'OTHER';
  mortgageCapabilitiesOk: boolean;
  helocCapabilitiesOk: boolean;
  bankCapabilitiesOk: boolean;
  brokerageCapabilitiesOk: boolean;
}

export interface ActivationPolicyInput {
  symbol: string;
  userMonthlyCapCents: bigint;
  platformMonthlyDrawCapCents: bigint;
}

export interface StrategyActivationInput {
  tenantId: string;
  userId: string;
  timezone: string;
  expectedPaymentDay: number;
  acknowledgeRiskDisclosures: boolean;
  accounts: ActivationAccountBundle;
  policy: ActivationPolicyInput | null;
  /** Other strategies already using any of these accounts incompatibly (ACTIVE/PAUSED). */
  incompatiblyLinkedAccountIds: string[];
}

/**
 * Full strategy activation gate. HTTP handlers must call this via an application service —
 * never implement financial side effects here.
 */
export function assertStrategyActivation(input: StrategyActivationInput): void {
  if (!input.acknowledgeRiskDisclosures) {
    throw new DomainError('VALIDATION_ERROR', 'Risk disclosures must be acknowledged');
  }

  asCanadianTimezone(input.timezone);

  if (input.expectedPaymentDay < 1 || input.expectedPaymentDay > 28) {
    throw new DomainError('VALIDATION_ERROR', 'expectedPaymentDay must be between 1 and 28', {
      expectedPaymentDay: input.expectedPaymentDay,
    });
  }

  assertStrategyAccountBindings({
    tenantId: input.tenantId,
    userId: input.userId,
    mortgage: input.accounts.mortgage,
    heloc: input.accounts.heloc,
    bankOperating: input.accounts.bankOperating,
    brokerageCash: input.accounts.brokerageCash,
  });

  if (input.accounts.brokerageRegistrationType !== 'NON_REGISTERED') {
    throw new DomainError('VALIDATION_ERROR', 'Brokerage account must be non-registered for MVP', {
      registrationType: input.accounts.brokerageRegistrationType,
    });
  }

  if (!input.accounts.mortgageCapabilitiesOk) {
    throw new DomainError(
      'UNSUPPORTED_ACCOUNT_CAPABILITY',
      'Mortgage missing required capabilities',
    );
  }
  if (!input.accounts.helocCapabilitiesOk) {
    throw new DomainError('UNSUPPORTED_ACCOUNT_CAPABILITY', 'HELOC missing required capabilities');
  }
  if (!input.accounts.bankCapabilitiesOk) {
    throw new DomainError(
      'UNSUPPORTED_ACCOUNT_CAPABILITY',
      'Ordinary bank account missing required capabilities',
    );
  }
  if (!input.accounts.brokerageCapabilitiesOk) {
    throw new DomainError(
      'UNSUPPORTED_ACCOUNT_CAPABILITY',
      'Brokerage account missing required capabilities',
    );
  }

  if (!input.policy || !input.policy.symbol.trim()) {
    throw new DomainError('VALIDATION_ERROR', 'ETF investment policy must be configured');
  }
  if (input.policy.userMonthlyCapCents <= 0n) {
    throw new DomainError('VALIDATION_ERROR', 'Monthly cap must be positive');
  }
  if (input.policy.userMonthlyCapCents > input.policy.platformMonthlyDrawCapCents) {
    throw new DomainError('VALIDATION_ERROR', 'Monthly cap exceeds platform draw cap', {
      userMonthlyCapCents: input.policy.userMonthlyCapCents.toString(),
      platformMonthlyDrawCapCents: input.policy.platformMonthlyDrawCapCents.toString(),
    });
  }

  if (input.incompatiblyLinkedAccountIds.length > 0) {
    throw new DomainError(
      'OWNERSHIP_VIOLATION',
      'One or more accounts are already linked to another active strategy',
      { accountIds: input.incompatiblyLinkedAccountIds },
    );
  }
}
