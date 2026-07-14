import { DomainError } from '../errors.js';

/**
 * Security quantity as a normalized decimal string (no floats).
 * Accepts up to 10 fractional digits.
 */
export type SecurityQuantity = string & { readonly __brand: 'SecurityQuantity' };

const QUANTITY_RE = /^(?:0|[1-9]\d*)(?:\.\d{1,10})?$/;

export function asSecurityQuantity(value: string): SecurityQuantity {
  const trimmed = value.trim();
  if (!QUANTITY_RE.test(trimmed)) {
    throw new DomainError('INVALID_QUANTITY', `Invalid security quantity: ${value}`);
  }
  return trimmed as SecurityQuantity;
}

export type SecurityPrice = string & { readonly __brand: 'SecurityPrice' };

const PRICE_RE = /^(?:0|[1-9]\d*)(?:\.\d{1,10})?$/;

export function asSecurityPrice(value: string): SecurityPrice {
  const trimmed = value.trim();
  if (!PRICE_RE.test(trimmed)) {
    throw new DomainError('INVALID_QUANTITY', `Invalid security price: ${value}`);
  }
  return trimmed as SecurityPrice;
}
