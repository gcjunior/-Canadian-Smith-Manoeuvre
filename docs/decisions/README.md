# Architecture Decision Records

ADRs capture significant, durable choices for the Canadian Smith Manoeuvre simulator.

| ADR                                                          | Title                                                         | Status   |
| ------------------------------------------------------------ | ------------------------------------------------------------- | -------- |
| [ADR-0001](./0001-temporal-schedule-vs-cron.md)              | Temporal Schedule instead of OS cron                          | Accepted |
| [ADR-0002](./0002-durable-polling-plus-webhook-signal.md)    | Durable polling plus optional webhook Signal                  | Accepted |
| [ADR-0003](./0003-postgresql.md)                             | PostgreSQL                                                    | Accepted |
| [ADR-0004](./0004-modular-monolith-separate-processes.md)    | Modular monolith with separate deployable processes           | Accepted |
| [ADR-0005](./0005-integer-cents-for-money.md)                | Integer cents for money                                       | Accepted |
| [ADR-0006](./0006-append-only-ledger.md)                     | Append-only ledger                                            | Accepted |
| [ADR-0007](./0007-one-workflow-per-monthly-cycle.md)         | One workflow per monthly conversion cycle                     | Accepted |
| [ADR-0008](./0008-coordinator-vs-schedule-started-cycles.md) | Long-lived coordinator vs Schedule-started independent cycles | Accepted |
| [ADR-0009](./0009-at-most-one-active-cycle.md)               | At-most-one active cycle per strategy and payment period      | Accepted |

## ADR format

Each ADR includes Context, Decision, Consequences, and (where useful) Alternatives considered.
