const SENSITIVE_KEY_PATTERN =
  /(password|secret|token|authorization|credential|accountNumber|sin|ssn|api[_-]?key)/i;

export function redactValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
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
