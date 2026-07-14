/** Integer CAD amount in cents. Never use floating-point for money. */
export type CadCents = bigint;

export class MoneyError extends Error {
  readonly code = 'INVALID_MONEY' as const;
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

const CENTS_PER_DOLLAR = 100n;

export function parseCadDollarsToCents(value: string): CadCents {
  const trimmed = value.trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) {
    throw new MoneyError(`Invalid CAD dollar amount: ${value}`);
  }
  const sign = match[1] === '-' ? -1n : 1n;
  const dollars = BigInt(match[2]!);
  const fraction = match[3] ?? '';
  const centsPart = BigInt(fraction.padEnd(2, '0'));
  return sign * (dollars * CENTS_PER_DOLLAR + centsPart);
}

export function formatCadCents(cents: CadCents): string {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const dollars = absolute / CENTS_PER_DOLLAR;
  const remainder = absolute % CENTS_PER_DOLLAR;
  const body = `${dollars.toString()}.${remainder.toString().padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}

export function minCents(...values: CadCents[]): CadCents {
  if (values.length === 0) {
    throw new MoneyError('minCents requires at least one value');
  }
  return values.reduce((acc, value) => (value < acc ? value : acc));
}
