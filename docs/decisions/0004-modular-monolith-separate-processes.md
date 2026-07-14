# ADR-0004: Modular monolith with separate deployable processes

- **Status:** Accepted
- **Date:** 2026-07-13

## Context

The system has HTTP API, UI, and Temporal worker concerns. Microservices would separate DB ownership early, increasing distributed complexity without clear MVP scale need. A single OS process mixing HTTP and workers couples failure and scaling axes.

## Decision

Adopt a **modular monolith** (shared packages + one Postgres) deployed as **separate processes**:

- `apps/api` — Fastify HTTP
- Temporal **worker** process — workflows + activities
- `apps/web` — Next.js

Modules (`domain`, `db`, `simulators`, `temporal`, `shared`) enforce boundaries via package imports.

## Consequences

### Positive

- Simple transactions and local reasonability.
- Scale/retry API vs worker independently.
- Clear path to extract a module later if needed.

### Negative

- Discipline required to prevent package boundary rot.
- Shared DB means schema coordination across processes.

## Alternatives considered

| Alternative               | Why not                                                 |
| ------------------------- | ------------------------------------------------------- |
| Single process API+worker | Blast radius; cannot scale workers alone                |
| Microservices per context | Premature; distributed transactions across ledger steps |
| Serverless-only           | Awkward multi-day Temporal waits and local DX           |

## Related

- [system-architecture.md](../system-architecture.md)
