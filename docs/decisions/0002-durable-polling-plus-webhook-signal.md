# ADR-0002: Durable polling plus optional webhook Signal

- **Status:** Accepted
- **Date:** 2026-07-13

## Context

Mortgage payments and HELOC credit updates settle asynchronously. The Schedule must not assume settlement. We need a reliable way to notice `SETTLED` status, with an optional fast path when the bank simulator pushes a webhook.

## Decision

1. The monthly conversion workflow **polls** the bank via Activities on a **six-hour** cadence until success criteria are met (payment settled; HELOC credit reflected; draw/deposit/order confirmed as applicable).
2. Authenticated **webhooks** may **Signal** the running workflow to wake immediately and poll.
3. **Provider GET remains source of truth**; Signals never authorize money movement alone.

## Consequences

### Positive

- Correct under delayed/missing webhooks.
- Faster UX/demo when webhooks fire.
- Deterministic workflows: Signals + timers are Temporal-native.

### Negative

- Worst-case detection latency ≈ poll interval (6h) if webhooks fail.
- Must harden webhook idempotency and signature verification.

## Alternatives considered

| Alternative           | Why not                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------- |
| Webhook-only          | Fragile if delivery fails; Schedule would hang forever without complex timeouts elsewhere |
| Sub-minute polling    | Unnecessary load; payments settle on banking timescales                                   |
| Busy wait in Activity | Holds worker slots; poor Temporal practice                                                |

## Related

- [monthly-conversion-workflow.md](../monthly-conversion-workflow.md)
- [failure-model.md](../failure-model.md)
