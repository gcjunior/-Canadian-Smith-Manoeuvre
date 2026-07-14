# ADR-0005: Integer cents for money

- **Status:** Accepted
- **Date:** 2026-07-13

## Context

CAD amounts participate in caps, draws, transfers, and reconciliation. IEEE floating point is unsafe for money. Need a single representation across API, DB, Workflow payloads (serialized), and ledger.

## Decision

- Represent all CAD monetary amounts as **integer cents** (`bigint` in TypeScript; `BIGINT` in PostgreSQL).
- Parse/format dollar strings only at boundaries via shared helpers.
- Represent **security quantities** as decimal **strings** (or Decimal type), never floats.
- **Forbid** floating-point arithmetic for money in domain and activities.

## Consequences

### Positive

- Exact arithmetic for `min()` caps and balanced ledger checks.
- Avoids classic `0.1 + 0.2` bugs.

### Negative

- Display layer must format cents → dollars carefully.
- Cross-currency not supported in MVP (acceptable).

## Alternatives considered

| Alternative             | Why not                                                 |
| ----------------------- | ------------------------------------------------------- |
| `number` dollars        | Precision risk                                          |
| Decimal for cash        | Heavier; cents suffice for CAD cash                     |
| minor units as `number` | Exceeds `Number.SAFE_INTEGER` risk for large aggregates |

## Related

- Phase 0 `@csm/shared` money helpers
- ADR-0006
