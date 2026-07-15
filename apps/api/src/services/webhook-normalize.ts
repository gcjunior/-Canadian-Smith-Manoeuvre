import { createHash } from 'node:crypto';

import { z } from 'zod';

/** Envelope accepted from bank/brokerage simulators and contract-shaped payloads. */
const simulatorEnvelopeSchema = z
  .object({
    type: z.string().min(1).optional(),
    eventType: z.string().min(1).optional(),
    data: z.record(z.unknown()).optional(),
    payload: z.record(z.unknown()).optional(),
    occurredAt: z.string().optional(),
    providerEventId: z.string().min(1).optional(),
    externalAccountId: z.string().min(1).optional(),
    broken: z.boolean().optional(),
  })
  .passthrough();

export interface ParsedWebhookEnvelope {
  eventType: string;
  providerEventId: string;
  externalAccountId: string;
  occurredAt: string | undefined;
  data: Record<string, unknown>;
  permanentlyInvalid: boolean;
  invalidReason?: string;
}

export function parseWebhookEnvelope(
  rawBody: Buffer,
  headerExternalAccountId: string | undefined,
): ParsedWebhookEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return {
      eventType: 'unknown',
      providerEventId: createHash('sha256').update(rawBody).digest('hex').slice(0, 48),
      externalAccountId: headerExternalAccountId ?? '',
      occurredAt: undefined,
      data: {},
      permanentlyInvalid: true,
      invalidReason: 'BODY_NOT_JSON',
    };
  }

  const envelope = simulatorEnvelopeSchema.safeParse(parsed);
  if (!envelope.success || envelope.data.broken === true) {
    const providerEventId =
      (typeof parsed === 'object' &&
      parsed &&
      'providerEventId' in parsed &&
      typeof (parsed as { providerEventId: unknown }).providerEventId === 'string'
        ? (parsed as { providerEventId: string }).providerEventId
        : null) ?? createHash('sha256').update(rawBody).digest('hex').slice(0, 48);
    return {
      eventType: 'malformed',
      providerEventId,
      externalAccountId: headerExternalAccountId ?? '',
      occurredAt: undefined,
      data: {},
      permanentlyInvalid: true,
      invalidReason: 'MALFORMED_PAYLOAD',
    };
  }

  const data =
    (envelope.data.data as Record<string, unknown> | undefined) ??
    (envelope.data.payload as Record<string, unknown> | undefined) ??
    {};
  const eventType =
    envelope.data.type ??
    envelope.data.eventType ??
    (typeof data.type === 'string' ? data.type : 'unknown');
  const providerEventId =
    envelope.data.providerEventId ??
    (typeof data.id === 'string' ? data.id : undefined) ??
    (typeof data.providerEventId === 'string' ? data.providerEventId : undefined) ??
    createHash('sha256').update(rawBody).digest('hex').slice(0, 48);
  const externalAccountId =
    envelope.data.externalAccountId ??
    headerExternalAccountId ??
    extractExternalAccountId(data) ??
    '';

  if (!externalAccountId) {
    return {
      eventType,
      providerEventId,
      externalAccountId: '',
      occurredAt: envelope.data.occurredAt,
      data,
      permanentlyInvalid: true,
      invalidReason: 'MISSING_EXTERNAL_ACCOUNT_ID',
    };
  }

  return {
    eventType,
    providerEventId,
    externalAccountId,
    occurredAt: envelope.data.occurredAt,
    data,
    permanentlyInvalid: false,
  };
}

function extractExternalAccountId(data: Record<string, unknown>): string | undefined {
  for (const key of ['mortgageId', 'helocId', 'accountId', 'debitAccountId', 'externalAccountId']) {
    const value = data[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function isYearMonthPeriod(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function extractPaymentPeriod(data: Record<string, unknown>): string | undefined {
  return isYearMonthPeriod(data.paymentPeriod) ? data.paymentPeriod : undefined;
}

export function extractInterestPeriod(data: Record<string, unknown>): string | undefined {
  return isYearMonthPeriod(data.interestPeriod) ? data.interestPeriod : undefined;
}

export function isInterestRelatedWebhook(
  eventType: string,
  interestPeriod: string | undefined,
): boolean {
  return eventType.includes('heloc.interest') || interestPeriod !== undefined;
}

export function extractProviderResourceId(
  data: Record<string, unknown>,
  eventType: string,
): string | undefined {
  if (typeof data.providerPaymentId === 'string') {
    return data.providerPaymentId;
  }
  if (typeof data.providerChargeId === 'string') {
    return data.providerChargeId;
  }
  if (typeof data.providerDrawId === 'string') {
    return data.providerDrawId;
  }
  if (typeof data.providerTransferId === 'string') {
    return data.providerTransferId;
  }
  if (typeof data.providerOrderId === 'string') {
    return data.providerOrderId;
  }
  if (typeof data.providerDepositId === 'string') {
    return data.providerDepositId;
  }
  if (typeof data.id === 'string' && !eventType.includes('availability')) {
    return data.id;
  }
  return undefined;
}

export interface NormalizedWebhookSignal {
  providerEventId: string;
  accountId: string;
  eventType: string;
  providerResourceId?: string;
  occurredAt?: string;
  providerType: 'BANK' | 'BROKERAGE';
}

export function normalizeWebhookSignal(input: {
  providerEventId: string;
  accountId: string;
  eventType: string;
  providerType: 'BANK' | 'BROKERAGE';
  data: Record<string, unknown>;
  occurredAt?: string;
}): NormalizedWebhookSignal {
  const resourceId = extractProviderResourceId(input.data, input.eventType);
  return {
    providerEventId: input.providerEventId,
    accountId: input.accountId,
    eventType: input.eventType,
    providerType: input.providerType,
    ...(resourceId !== undefined ? { providerResourceId: resourceId } : {}),
    ...(input.occurredAt !== undefined ? { occurredAt: input.occurredAt } : {}),
  };
}
