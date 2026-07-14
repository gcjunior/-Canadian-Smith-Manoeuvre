# ADR-0001: Temporal Schedule instead of operating-system cron

- **Status:** Accepted
- **Date:** 2026-07-13

## Context

Monthly conversion and interest confirmation must start after expected calendar dates in the strategy’s IANA timezone. Traditional options include OS cron, Kubernetes CronJob, or an external scheduler calling “start workflow” APIs.

We already require Temporal for durable orchestration of multi-day waits (settlement polling, HELOC lag, deposit/order confirmation).

## Decision

Use **Temporal Schedules** as the sole production scheduler for starting conversion and interest workflows.

OS cron / CronJobs are not used to start business workflows in MVP.

## Consequences

### Positive

- Schedule state, pauses, and backfills live next to workflow history.
- Timezone-aware calendars without custom cron parsers.
- Pausing a strategy can pause its Schedule via API in the same control plane.
- Local Docker Temporal supports Schedules for parity with production.

### Negative

- Requires Temporal availability for scheduling (mitigated: Temporal is already a hard dependency).
- Team must learn Schedule semantics (overlap policies, catch-up).

## Alternatives considered

| Alternative           | Why not                                                               |
| --------------------- | --------------------------------------------------------------------- |
| OS cron on a VM       | No durability story; drift vs workflow pauses; weak multi-tenant ops  |
| K8s CronJob           | Couples scheduling to deploy platform; still needs Temporal for waits |
| App-level `node-cron` | Lost on process restart; duplicates Temporal features                 |

## Related

- ADR-0008 (independent cycles started by Schedule)
- ADR-0009 (overlap / at-most-one)
