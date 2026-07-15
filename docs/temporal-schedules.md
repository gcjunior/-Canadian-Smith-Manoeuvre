# Temporal Schedules for monthly conversion

## Purpose

Each **ACTIVE** strategy has exactly one Temporal Schedule that starts an independent
`MonthlyConversionWorkflow` for each mortgage payment period. OS cron and
application `setInterval` are not used (ADR-0001).

## Schedule identity

```
monthly-conversion-schedule/{tenantId}/{strategyId}
```

## Fire time (MVP, monthly)

- Strategy fields: IANA `timezone`, `expectedPaymentDay` (API: 1–28).
- **Clamp** the configured day to the last day of the month when it does not exist
  (documented example: a configured “February 30” becomes February 28/29).
- First conversion **check** runs at **09:00 local** on the **calendar day after**
  that clamped payment day.
- Schedule fire is **not** evidence of payment; the Workflow verifies settlement.

## Missing calendar days / February

| Situation                                                | Policy                                      |
| -------------------------------------------------------- | ------------------------------------------- |
| Configured day > days in month                           | Clamp to last day of month                  |
| Check would be day 29 and February has no 29th           | Additional calendar fires **1 March 09:00** |
| Leap year: Feb 29 and Mar 1 both derive period `YYYY-02` | Deterministic Workflow ID absorbs duplicate |

## Workflow start

Schedule starts `monthlyConversionScheduleKickoff`, which:

1. Derives `paymentPeriod` (`YYYY-MM`) and `expectedPaymentDate` from Temporal time.
2. Starts child `monthlyConversionWorkflow` with Workflow ID  
   `monthly-conversion/{tenantId}/{strategyId}/{paymentPeriod}`.
3. Uses `ParentClosePolicy.ABANDON` so the kickoff may complete while conversion continues.
4. Treats “already started” for that Workflow ID as success (idempotent duplicate trigger).

## Policies

| Setting          | Value    | Rationale                                                                              |
| ---------------- | -------- | -------------------------------------------------------------------------------------- |
| Overlap          | `SKIP`   | At most one conversion Action per strategy Schedule while prior Action runs (ADR-0009) |
| Catch-up window  | `3 days` | Explicit; recovers short Temporal downtime without unbounded backlog                   |
| Pause on failure | `false`  | Failures pause the **strategy** via Activities, not the Schedule automatically         |

## Lifecycle

| Strategy state | Schedule                                               |
| -------------- | ------------------------------------------------------ |
| Activate       | Create or update Schedule (idempotent); unpaused       |
| Pause          | Pause Schedule                                         |
| Resume         | Unpause Schedule                                       |
| Close          | Delete Schedule (or permanently pause if delete fails) |

Database table `strategy_schedules` stores the Temporal Schedule id and paused flag for reconcile/repair.

## Sibling: HELOC interest Schedule

Each ACTIVE strategy also has a second Temporal Schedule for HELOC interest checks:

```
heloc-interest-schedule/{tenantId}/{strategyId}
```

It uses the same overlap (`SKIP`) and catch-up (`3 days`) policies, fires
`helocInterestScheduleKickoff` from `expectedInterestChargeDay` (default 1), and is
created/paused/resumed/deleted alongside the conversion Schedule. Workflow ID:

```
heloc-interest/{tenantId}/{strategyId}/{interestPeriod}
```

## Repair

```bash
pnpm --filter @csm/api repair:schedules -- --tenant <tenantId>
```

Reconciles ACTIVE/PAUSED/CLOSED strategies against Temporal Schedule state.
