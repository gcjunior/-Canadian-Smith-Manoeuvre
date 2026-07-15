/** Format CAD cents (string of integer cents) for Canadian display. */
export function formatCadCents(cents: string | number | null | undefined): string {
  if (cents === null || cents === undefined || cents === '') return '—';
  const raw = typeof cents === 'string' ? cents.trim() : String(Math.trunc(cents));
  if (!/^-?\d+$/.test(raw)) return '—';
  const negative = raw.startsWith('-');
  const abs = negative ? raw.slice(1) : raw;
  const padded = abs.padStart(3, '0');
  const dollars = padded.slice(0, -2);
  const fraction = padded.slice(-2);
  const signed = `${negative ? '-' : ''}${dollars}.${fraction}`;
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(Number(signed));
}

/**
 * Parse a CAD dollars input to integer cents as a decimal string.
 * Avoids IEEE float (e.g. 19.99 * 100). Accepts up to 2 decimal places.
 */
export function dollarsInputToCents(dollars: string): string {
  const normalized = dollars
    .trim()
    .replace(/,/g, '')
    .replace(/[^0-9.]/g, '');
  if (!normalized || normalized === '.') {
    throw new Error('Enter a positive CAD amount');
  }
  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) {
    throw new Error('Enter a valid CAD amount with up to 2 decimal places');
  }
  const [wholePart, fracPart = ''] = normalized.split('.');
  const whole = wholePart === '' ? '0' : wholePart;
  const frac = (fracPart + '00').slice(0, 2);
  const cents = BigInt(whole) * 100n + BigInt(frac);
  if (cents <= 0n) {
    throw new Error('Enter a positive CAD amount');
  }
  return cents.toString();
}
