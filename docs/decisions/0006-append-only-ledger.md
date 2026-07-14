# ADR-0006: Append-only ledger

- **Status:** Accepted
- **Date:** 2026-07-13

## Context

Conversion and interest flows require an auditable money trail. Mutable balances alone lose history and complicate dispute/replay. Corrections must not silently rewrite history.

## Decision

Persist financial effects as **append-only ledger entries**. Balances are projections (materialized snapshots allowed, always rebuildable). Corrections use **reversing entries**, never in-place updates of amounts.

Provider payloads and audit events are also append-oriented; audits are immutable.

## Consequences

### Positive

- Full money tracing per `cycleId` / `correlationId`.
- Safer concurrent writes with uniqueness constraints on idempotency keys.
- Aligns with reconciliation-as-verification of facts.

### Negative

- Queries for current balance need snapshots or aggregates.
- Storage growth (manage with retention policy—unresolved question).

## Alternatives considered

| Alternative                   | Why not                               |
| ----------------------------- | ------------------------------------- |
| Mutable balance-only accounts | Insufficient audit trail              |
| Overwrite ledger rows         | Violates financial audit expectations |

## Related

- [system-architecture.md](../system-architecture.md) § Reconciliation
- [security-and-tenancy.md](../security-and-tenancy.md)
