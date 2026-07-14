# ADR-0003: PostgreSQL

- **Status:** Accepted
- **Date:** 2026-07-13

## Context

We need a relational store for tenants, strategies, append-only ledger entries, idempotency keys, audit events, and simulator state, with strong constraints and transactional writes across multiple legs of a money movement.

## Decision

Use **PostgreSQL** as the system of record, accessed via **Prisma**, with committed migrations in-repo.

## Consequences

### Positive

- Mature constraints (`UNIQUE (tenant_id, …)`), transactions, and ops tooling.
- Good Temporal companion for app data (Temporal may use Postgres separately in Docker auto-setup).
- Integer cents map cleanly to `BIGINT`.

### Negative

- Horizontal write sharding not needed for MVP but would require care later.
- Must avoid Destructive migrations without explicit warning/process.

## Alternatives considered

| Alternative | Why not                                                          |
| ----------- | ---------------------------------------------------------------- |
| SQLite      | Weak multi-process story for API + worker                        |
| MongoDB     | Weaker financial constraint model for balanced ledger invariants |
| DynamoDB    | Overkill; local DX and relational constraints poorer for MVP     |

## Related

- ADR-0006 Append-only ledger
- [security-and-tenancy.md](../security-and-tenancy.md)
