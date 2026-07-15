/** Duck-type provider client errors (bank vs brokerage packages duplicate classes). */

export function isProviderNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    (error as { statusCode?: unknown }).statusCode === 404
  );
}

export function isProviderAmbiguous(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'kind' in error &&
    (error as { kind?: unknown }).kind === 'AMBIGUOUS_RESULT'
  );
}

export function providerErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
