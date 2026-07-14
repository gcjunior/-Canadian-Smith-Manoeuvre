/**
 * Fixed-scale decimal arithmetic (up to 10 fractional digits).
 * Never uses IEEE floats for quantity or price.
 */
export const DECIMAL_SCALE = 10n;
export const SCALE = 10n ** DECIMAL_SCALE;

const DECIMAL_RE = /^(?:0|[1-9]\d*)(?:\.\d{1,10})?$/;

export function parseDecimal(input: string): bigint {
  if (!DECIMAL_RE.test(input)) {
    throw new Error(`Invalid decimal string: ${input}`);
  }
  const negative = input.startsWith('-');
  const raw = negative ? input.slice(1) : input;
  const [wholePart = '0', fracPart = ''] = raw.split('.');
  const padded = (fracPart + '0'.repeat(Number(DECIMAL_SCALE))).slice(0, Number(DECIMAL_SCALE));
  const scaled = BigInt(wholePart) * SCALE + BigInt(padded || '0');
  return negative ? -scaled : scaled;
}

export function formatDecimal(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / SCALE;
  let frac = (abs % SCALE).toString().padStart(Number(DECIMAL_SCALE), '0');
  frac = frac.replace(/0+$/, '');
  const body = frac.length > 0 ? `${whole}.${frac}` : whole.toString();
  return negative ? `-${body}` : body;
}

/** qty * price (dollars) → CAD cents, half-up rounding. */
export function multiplyToCents(qtyScaled: bigint, priceScaled: bigint): bigint {
  const num = qtyScaled * priceScaled * 100n;
  const den = SCALE * SCALE;
  return (num + den / 2n) / den;
}

/** quantity from notional cents at a dollar price (floor). */
export function quantityFromNotionalCents(notionalCents: bigint, priceScaled: bigint): bigint {
  if (priceScaled <= 0n) {
    throw new Error('Price must be positive');
  }
  return (notionalCents * SCALE * SCALE) / (priceScaled * 100n);
}

export function addScaled(a: bigint, b: bigint): bigint {
  return a + b;
}

export function subScaled(a: bigint, b: bigint): bigint {
  return a - b;
}

/** Apply absolute dollar spread to a buy price (price + spread). */
export function applyBuySpread(priceScaled: bigint, spreadScaled: bigint): bigint {
  return priceScaled + spreadScaled;
}

/** Move price by absolute dollar delta (can be negative). */
export function applyPriceMove(priceScaled: bigint, moveScaled: bigint): bigint {
  const next = priceScaled + moveScaled;
  return next > 0n ? next : 1n;
}
