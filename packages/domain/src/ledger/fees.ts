/**
 * MVP policy: only explicitly supported brokerage deposit fees may bridge
 * transfer amount vs deposit amount. Default supported fee is $0.00.
 */
export const SUPPORTED_BROKERAGE_DEPOSIT_FEE_CENTS = 0n;

export function depositMatchesTransfer(input: {
  transferCents: bigint;
  depositCents: bigint;
  feeCents?: bigint;
}): boolean {
  const fee = input.feeCents ?? SUPPORTED_BROKERAGE_DEPOSIT_FEE_CENTS;
  if (fee !== SUPPORTED_BROKERAGE_DEPOSIT_FEE_CENTS && fee !== 0n) {
    // Unknown fee codes are not auto-supported.
    return false;
  }
  return input.transferCents === input.depositCents + fee;
}
