const SENSITIVE_KEY_PATTERN =
  /(password|secret|token|authorization|credential|accountNumber|account_number|sin|ssn|tin|api[_-]?key|jwt|bearer|webhook[_-]?signing|accessToken|refreshToken|tax(Id|Identifier|Number)|sinNumber)/i;

const SENSITIVE_VALUE_HINT = /^(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/; // JWT-shaped

export function redactValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return '[REDACTED]';
  }
  if (typeof value === 'string' && SENSITIVE_VALUE_HINT.test(value)) {
    return '[REDACTED]';
  }
  // Never log full account numbers that look like 10+ digit PANs / account ids in free text keys.
  if (
    typeof value === 'string' &&
    /account/i.test(key) &&
    /^\d{10,}$/.test(value.replace(/[\s-]/g, ''))
  ) {
    return '[REDACTED]';
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => redactValue(String(index), item));
  }
  if (value !== null && typeof value === 'object') {
    return redactObject(value as Record<string, unknown>);
  }
  return value;
}

export function redactObject(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = redactValue(key, value);
  }
  return output;
}
