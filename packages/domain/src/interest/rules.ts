import { DomainError } from '../errors.js';

/** Amount equality for HELOC interest charge vs ordinary-bank debit (MVP: exact cents). */
export function assertInterestAmountsEqual(chargeCents: bigint, debitCents: bigint): void {
  if (chargeCents !== debitCents) {
    throw new DomainError('VALIDATION_ERROR', 'Interest charge and debit amounts differ', {
      chargeCents: chargeCents.toString(),
      debitCents: debitCents.toString(),
    });
  }
}

/**
 * Interest must be paid only from BANK_OPERATING.
 * Never brokerage cash/positions and never HELOC draw proceeds.
 */
export function assertInterestDebitSourceAllowed(input: {
  sourceAccountKind: string;
  sourceAccountId: string;
  configuredOrdinaryAccountId: string;
  helocAccountId: string;
  brokerageAccountId: string;
}): void {
  if (input.sourceAccountKind !== 'BANK_OPERATING') {
    throw new DomainError('VALIDATION_ERROR', 'Interest debit source must be BANK_OPERATING', {
      sourceAccountKind: input.sourceAccountKind,
    });
  }
  if (input.sourceAccountId !== input.configuredOrdinaryAccountId) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'Interest debit source is not the strategy ordinary bank account',
      {
        sourceAccountId: input.sourceAccountId,
        configuredOrdinaryAccountId: input.configuredOrdinaryAccountId,
      },
    );
  }
  if (
    input.sourceAccountId === input.helocAccountId ||
    input.sourceAccountId === input.brokerageAccountId
  ) {
    throw new DomainError(
      'VALIDATION_ERROR',
      'Interest must not be paid from HELOC or brokerage accounts',
    );
  }
}

/**
 * Domain policy: failed interest monitoring pauses the strategy, which also
 * pauses future monthly investment conversions (HELOC is not operating normally).
 * Monitoring-only pause is explicitly opted out of for MVP.
 */
export const INTEREST_FAILURE_POLICY = {
  /** Pause strategy → conversion Schedule pauses with it. */
  pauseFutureConversions: true as const,
  /** When false, interest-cycle failure alone is insufficient — strategy pause required. */
  pauseInterestMonitoringOnly: false as const,
  reason: 'Default: pause future conversion because the HELOC is not operating normally.',
} as const;

export function shouldPauseFutureConversionsOnInterestFailure(): boolean {
  return INTEREST_FAILURE_POLICY.pauseFutureConversions;
}
