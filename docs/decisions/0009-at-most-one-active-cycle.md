# ADR-0009: At-most-one active cycle per strategy and payment period

- **Status:** Accepted
- **Date:** 2026-07-13

## Context

Duplicate starts (Schedule overlap, retries, manual replay, double webhook+Schedule) must not create two simultaneous draws/investments for the same mortgage payment period.

## Decision

Enforce **at most one active conversion cycle** per `(strategyId, paymentPeriodId)` using layered controls:

1. **Deterministic Temporal workflow id:**  
   `conversion:{tenantId}:{strategyId}:{paymentPeriodId}`  
   (tenant included to keep ids globally clear in shared namespaces).
2. **Schedule overlap policy:** skip or buffer per Temporal Schedule settings so a new start does not run concurrent duplicates.
3. **Database uniqueness:** `UNIQUE (tenant_id, strategy_id, payment_period_id)` on `conversion_cycle`.
4. **Strategy pause** blocks new starts even if Schedule misconfigured.

Interest cycles use an analogous key: `heloc-interest:{tenantId}:{strategyId}:{interestPeriodId}`.

## Consequences

### Positive

- Safe under at-least-once schedulers.
- Clear ops story: inspect one workflow id per period.

### Negative

- Payment period ID scheme must be stable (document format, e.g. `YYYY-MM` in strategy timezone).
- Manual remediations require explicit “reset/cancel then allow new id version” playbooks if a cycle is stuck (rare; prefer reconcile+pause).

## Alternatives considered

| Alternative                                    | Why not                                  |
| ---------------------------------------------- | ---------------------------------------- |
| Allow parallel cycles; last writer wins        | Double-draw risk — unacceptable          |
| Only DB lock without deterministic workflow id | Race between Schedule and Temporal start |
| Only Temporal id without DB unique             | Weaker app-level query invariants        |

## Related

- ADR-0007, ADR-0008
- [failure-model.md](../failure-model.md)
