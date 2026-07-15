# Edmonton deterministic demo

End-to-end Canadian Smith Manoeuvre demonstration for a simulated household in **America/Edmonton**.

## What it proves

| Proof                                    | How                                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| No investment before mortgage settlement | Clock pauses at POSTED; asserts zero draws / transfers / orders                         |
| No investment before HELOC readvance     | Clock pauses after SETTLED, before +12h readvance; same assertions                      |
| Exactly one draw, transfer, and order    | DB + simulator store counts after COMPLETED                                             |
| Retries do not duplicate                 | Idempotency keys + store size assertions                                                |
| Ledger balances                          | `assertLedgerBalanced` on cycle ledger package                                          |
| Interest paid from ordinary account      | Interest Workflow + `ordinaryBankAccountId` check                                       |
| Customer dashboard **Completed**         | `toCustomerCycleStatus(COMPLETED) === 'Completed'`                                      |
| Ambiguous draw does not double-submit    | Fixture `edmonton-ambiguous-draw` (`TIMEOUT_AFTER_SUCCESS`); resolve by idempotency key |

## Scenario numbers

| Item                      | Value                                     |
| ------------------------- | ----------------------------------------- |
| Mortgage payment          | $2,400 (interest $1,630 / principal $770) |
| Post / settle / readvance | 12h / 48h / 12h (simulated)               |
| Strategy monthly cap      | $1,000                                    |
| Platform monthly cap      | $5,000                                    |
| Investment amount         | $770                                      |
| HELOC draw settle         | 2h                                        |
| Brokerage deposit settle  | 4h                                        |
| ETF                       | XEQT @ $61.99 fractional                  |

## Commands

Prerequisites: Postgres migrated (`pnpm db:migrate:deploy`), Node 20+, `pnpm install`.

Demo seed/scenario commands connect to the Compose Postgres (`smith:smith@localhost:5432/smith_manoeuvre`) via the repo `.env` or built-in default — not your shell's `DATABASE_URL`. Override with `CSM_DATABASE_URL` if needed.

```bash
# Full stack (optional for manual walkthrough)
docker compose up -d postgres temporal
pnpm db:migrate:deploy

# Terminal A/B — simulators
pnpm --filter @csm/bank-simulator dev
pnpm --filter @csm/brokerage-simulator dev

# Seed mirrors simulator account UUIDs into Postgres
pnpm --filter @csm/demo seed -- --scenario edmonton-demo

# Advance simulators through post → settle → readvance (accelerated clock)
pnpm --filter @csm/demo scenario -- --scenario edmonton-demo

# Or advance an arbitrary simulated duration
pnpm --filter @csm/demo clock:advance -- --ms 43200000
```

### Automated proof (recommended)

In-process bank + brokerage + Temporal TestWorkflowEnvironment (no Compose API/worker required):

```bash
pnpm --filter @csm/demo test
```

This runs:

1. `edmonton-demo.e2e.test.ts` — gates, uniqueness, ledger, Completed, interest from ordinary
2. `edmonton-ambiguous-draw.e2e.test.ts` — draw API times out after success; system discovers existing draw; no second POST

### Playwright evidence (dashboard Completed)

With API + web running and after a completed demo cycle in Postgres:

```bash
pnpm --filter @csm/web test:browser -- e2e/demo-edmonton.spec.ts
```

Screenshots land under `apps/demo/evidence/` when `DEMO_EVIDENCE=1`.

## Second scenario: ambiguous HELOC draw

```bash
pnpm --filter @csm/demo seed -- --scenario edmonton-ambiguous-draw
pnpm --filter @csm/demo test
# or rely on the ambiguous e2e test inside pnpm --filter @csm/demo test
```

Bank fixture loads `deterministicFailureSteps: ['TIMEOUT_AFTER_SUCCESS']` for the draw.
The Workflow catches `AMBIGUOUS_RESULT`, calls `resolveAmbiguousHelocDraw` (GET by idempotency key), and continues without another POST.
