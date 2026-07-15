/**
 * Bootstrap smoke workflow used to verify Worker + Temporal connectivity.
 * Production money paths live in monthlyConversionWorkflow and helocInterestPaymentWorkflow.
 */
export async function pingWorkflow(message: string): Promise<string> {
  return `pong:${message}`;
}
