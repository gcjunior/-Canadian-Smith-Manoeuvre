# ADR-0008: Long-lived strategy coordinator vs Schedule-started independent cycles

- **Status:** Accepted
- **Date:** 2026-07-13

## Context

We must run monthly conversion cycles for years of strategy life. Two common Temporal patterns:

**Option A — Long-lived strategy coordinator (entity workflow)**  
One workflow per strategy runs indefinitely (with `continueAsNew`). It waits for “month tick” signals/timers, then runs child workflows or inline steps for each cycle. The Schedule might only signal the coordinator.

**Option B — Schedule-started independent monthly cycle workflows**  
A Temporal Schedule starts a new `MonthlyConversionWorkflow` each period. Strategy-level state (active/paused, caps) lives in PostgreSQL. No long-lived entity workflow is required for MVP.

## Comparison

| Dimension                         | A: Long-lived coordinator               | B: Independent Schedule-started cycles     |
| --------------------------------- | --------------------------------------- | ------------------------------------------ |
| Durability of month waits         | Excellent                               | Excellent (each cycle workflow durable)    |
| Per-month audit / history         | Nested; harder to isolate               | One history per period — clear             |
| Deterministic id / dedupe         | Coordinator must track in-flight month  | Native: `conversion:{strategyId}:{period}` |
| Pause / resume                    | Signal coordinator + DB                 | Pause Schedule + DB flag; simple           |
| `continueAsNew` burden            | Required for long life                  | Not required                               |
| Versioning / replay               | Sticky long histories; careful patching | Ship new code for next months easily       |
| Cross-cycle sequential guarantees | Natural single-threaded entity          | Enforced by ADR-0009 + DB uniqueness       |
| Why use it?                       | Complex interleaved entity events       | Simple calendared batch-like cycles        |
| Ops mental model                  | “One workflow = strategy forever”       | “One workflow = one month’s job”           |

### Clear benefits required to prefer A

A coordinator would be justified if we had continuous, high-frequency multi-signal coordination inside a single entity (e.g. many concurrent child processes per strategy with tight mutual exclusion beyond monthly cadence, or sub-daily stateful negotiation). The Smith Manoeuvre MVP cadence is **calendared monthly (+ separate interest)**, which Schedules already express.

## Decision

**Recommend and adopt Option B:** **independent monthly cycle workflows started by a Temporal Schedule**, unless a future requirement introduces continuous entity-level coordination that PostgreSQL + Schedules cannot express cleanly.

Strategy pause, caps, and account links remain in **PostgreSQL**. Schedules are paused/updated when strategy state changes.

Interest remains a **separate** Schedule + independent workflow type (not children of a conversion coordinator).

## Consequences

### Positive

- Aligns with ADR-0001, ADR-0007, ADR-0009.
- Simpler worker versioning and support timelines.
- Matches user mental model of monthly cycles.

### Negative

- Cross-month “saga” features must be modeled in DB (acceptable).
- Must correctly manage Schedule lifecycle when strategies activate/pause/archive.

## Related

- ADR-0001, ADR-0007, ADR-0009
- [monthly-conversion-workflow.md](../monthly-conversion-workflow.md)
