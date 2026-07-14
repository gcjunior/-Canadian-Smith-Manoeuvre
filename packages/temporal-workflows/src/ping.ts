/**
 * Scaffold-only workflow used to verify worker + Temporal bootstrap.
 * Financial conversion and interest workflows are intentionally not implemented yet.
 */
export async function pingWorkflow(message: string): Promise<string> {
  return `pong:${message}`;
}
