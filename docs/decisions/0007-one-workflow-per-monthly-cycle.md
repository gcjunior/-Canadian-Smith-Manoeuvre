# ADR-0007: One workflow per monthly conversion cycle

- **Status:** Accepted
- **Date:** 2026-07-13

## Context

A conversion cycle can span days (poll every 6 hours, HELOC lag, settlement). We need durable state, clear history per period, and isolation of failures between months.

## Decision

Each mortgage **payment period** for a strategy is executed by **exactly one** `MonthlyConversionWorkflow` execution (one cycle per workflow run). Interest uses a separate workflow type and period key.

The workflow completes when the cycle reaches a terminal state (`COMPLETED`, safety-failed/paused outcome, or cancelled).

## Consequences

### Positive

- Readable Temporal history per month.
- Deterministic workflow ids (with ADR-0009).
- Failed month does not leave an unbounded entity workflow continuing by accident.

### Negative

- Cross-month continuity (if ever needed) must use DB strategy state, not a single eternal workflow.

## Alternatives considered

| Alternative                                           | Why not for cycle itself                                       |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| Infinite loop inside one workflow handling all months | See ADR-0008; continueAsNew complexity; harder per-month audit |
| Activity-only without workflow                        | Loses durable timers/signals                                   |

## Related

- ADR-0008, ADR-0009
