# Failure-mode test matrix

This document maps required failure modes to automated tests. Assertions are not weakened to obtain green results; deferred cases are explicitly listed.

## Legend

| Layer    | Meaning                                                     |
| -------- | ----------------------------------------------------------- |
| Unit     | Pure domain / stub / policy tests                           |
| Repo     | Postgres repository integration                             |
| Provider | Bank/brokerage simulator engine & HTTP contract             |
| Temporal | `TestWorkflowEnvironment` time-skipping                     |
| Compose  | Docker Compose e2e (`docker-compose.test.yml` + `@csm/e2e`) |

Status: **Covered** | **Partial** | **Deferred**

---

## Settlement timing

| Failure mode                | Layer               | Automated test                                                                                           | Status  |
| --------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------- | ------- |
| Payment settles immediately | Provider + Temporal | `apps/bank-simulator/src/failure-pack.test.ts` · `packages/temporal-workflows/.../failure-suite.test.ts` | Covered |
| Payment takes one day       | Provider + Temporal | bank failure-pack (86_400_000 delay) · workflow `mortgageDelayPolls: 4`                                  | Covered |
| Payment takes five days     | Provider + Temporal | bank failure-pack · workflow `mortgageDelayPolls: 20`                                                    | Covered |
| Payment never settles       | Temporal            | `failure-suite` + existing `14-day mortgage timeout`                                                     | Covered |
| Reverse after posting       | Provider            | `REVERSED_AFTER_POSTING` in bank engine + failure-pack                                                   | Covered |
| Reverse after settlement    | Provider + Temporal | `REVERSED_MORTGAGE_PAYMENT` · workflow `reversePayment`                                                  | Covered |

## HELOC

| Failure mode                                | Layer               | Automated test                                                                | Status  |
| ------------------------------------------- | ------------------- | ----------------------------------------------------------------------------- | ------- |
| Credit readvances immediately               | Provider            | existing engine settle+readvance path · delay 0                               | Covered |
| Credit readvances late                      | Provider + Temporal | delayed readvance failure-pack · `helocCreditDelayPolls`                      | Covered |
| Existing unused credit, no new credit event | Temporal            | `existingAvailableCreditCents` + zero newly available → `INSUFFICIENT_CREDIT` | Covered |
| Credit insufficient                         | Provider + Temporal | `INSUFFICIENT_HELOC_CREDIT` · workflow insufficient credit                    | Covered |
| Account blocked                             | Provider            | `HELOC_BLOCKED` draw 422                                                      | Covered |
| Account delinquent                          | Provider            | `HELOC_DELINQUENT` draw 422                                                   | Covered |
| Draw rejected                               | Provider + Temporal | `DRAW_REJECTED` · workflow `rejectDraw`                                       | Covered |
| Draw timed out before processing            | Provider            | `TIMEOUT_BEFORE_PROCESSING`                                                   | Covered |
| Draw timed out after succeeding             | Provider + Temporal | `TIMEOUT_AFTER_SUCCESS` · `drawConfirmTimeout`                                | Covered |

## Transfer

| Failure mode               | Layer               | Automated test                                     | Status  |
| -------------------------- | ------------------- | -------------------------------------------------- | ------- |
| Pending for several days   | Provider            | transfer delay 3d then settle                      | Covered |
| Rejected                   | Provider + Temporal | `TRANSFER_REJECTED` · `rejectTransfer`             | Covered |
| Timed out after succeeding | Provider + Temporal | `TIMEOUT_AFTER_SUCCESS` · `transferConfirmTimeout` | Covered |
| Duplicate request          | Provider            | idempotent transfer replay                         | Covered |
| Reversed transfer          | Provider + Temporal | `TRANSFER_REVERSED` · `reverseTransfer`            | Covered |

## Brokerage

| Failure mode                    | Layer               | Automated test                                     | Status  |
| ------------------------------- | ------------------- | -------------------------------------------------- | ------- |
| Delayed deposit                 | Provider            | `depositSettlementDelayMs`                         | Covered |
| Deposit reversed                | Provider + Temporal | `DEPOSIT_REVERSED` · `reverseDeposit`              | Covered |
| Insufficient settled cash       | Provider            | insufficient-cash fixture                          | Covered |
| Order rejected                  | Provider + Temporal | `REJECTED_ORDER` · `rejectOrder`                   | Covered |
| Partial fill                    | Provider + Temporal | partial-fill fixture · `partialFill`               | Covered |
| Order timed out after fill      | Provider + Temporal | `TIMEOUT_AFTER_SUCCESS` · `orderConfirmTimeout`    | Covered |
| Price moves                     | Provider            | price-move fixture                                 | Covered |
| Account restricted              | Provider + Temporal | ACCOUNT_RESTRICTION · `accountRestricted`          | Covered |
| Symbol policy changed mid-cycle | Unit + Temporal     | recon `FILL_MATCHES_ORDER` · `symbolPolicyChanged` | Covered |

## Temporal

| Failure mode                              | Layer          | Automated test                                                                      | Status                                                                                                |
| ----------------------------------------- | -------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Worker stops mid-stage then resumes       | Temporal       | — (hangs under TestWorkflowEnvironment time-skipping without an active worker)      | **Deferred** — non-duplication covered by ambiguous draw resolve + history replay                     |
| Temporal server restarts mid-run          | Compose        | —                                                                                   | **Deferred** (needs killing Temporal container mid-history; not simulated in TestWorkflowEnvironment) |
| Activity retries                          | Unit           | `retry-failure-policies.test.ts` (non-retryable AMBIGUOUS_RESULT, polling envelope) | Covered                                                                                               |
| Duplicated Signals                        | Temporal       | existing monthly + interest duplicate signal tests                                  | Covered                                                                                               |
| Out-of-order Signals                      | Temporal + API | failure-suite OOO signal · webhook processing out-of-order                          | Covered                                                                                               |
| Schedule triggers twice                   | Unit           | `schedule-overlap-policy.test.ts` (`SKIP`)                                          | **Partial** (policy asserted; live double-fire against Temporal Schedule deferred)                    |
| Workflow replay after code change fixture | Temporal       | conversion + interest `Worker.runReplayHistory`                                     | Covered                                                                                               |
| Resume without duplicate money movement   | Temporal       | failure-suite ambiguous draw: initiate once + resolve once                          | Covered                                                                                               |

## Tenancy and security

| Failure mode                                       | Layer       | Automated test                                              | Status  |
| -------------------------------------------------- | ----------- | ----------------------------------------------------------- | ------- |
| User accesses another tenant's strategy            | Repo + Unit | tenant-isolation · `guards.test.ts` cross-user              | Covered |
| Forged tenantId in request body                    | API         | JWT context only (`app.test.ts`); body tenant never trusted | Covered |
| Webhook references another tenant's account        | API         | webhook-processing cross-tenant collision                   | Covered |
| Reused provider ID across tenants                  | Repo        | `provider-id-tenancy.test.ts`                               | Covered |
| Invalid webhook signature                          | API         | webhook-processing HMAC reject                              | Covered |
| Replayed webhook                                   | API         | webhook-processing duplicate                                | Covered |
| Sensitive values absent from logs / Workflow input | Unit        | `redact.test.ts`; workflow input contracts omit secrets     | Covered |

## Interest

| Failure mode                          | Layer               | Automated test                                   | Status  |
| ------------------------------------- | ------------------- | ------------------------------------------------ | ------- |
| Debit succeeds                        | Temporal + Provider | interest happy path · NSF pack contrast          | Covered |
| Insufficient ordinary-account funds   | Temporal + Provider | NSF failure-pack · `INSUFFICIENT_FUNDS` workflow | Covered |
| Interest payment reversed             | Temporal            | `debitState: REVERSED` → `DEBIT_REVERSED`        | Covered |
| Interest paid from unexpected account | Unit + Temporal     | interest rules + `unexpectedSource`              | Covered |
| Duplicate debit / duplicate signal    | Temporal + Repo     | interest duplicate signal · webhook uniqueness   | Covered |

## Reconciliation

| Failure mode                 | Layer | Automated test                                                            | Status  |
| ---------------------------- | ----- | ------------------------------------------------------------------------- | ------- |
| Every amount mismatch        | Unit  | `conversion-mismatch-matrix.test.ts` / `interest-mismatch-matrix.test.ts` | Covered |
| Duplicate provider reference | Unit  | `PROVIDER_TX_UNIQUE`                                                      | Covered |
| Missing fill                 | Unit  | `FILL_MATCHES_ORDER` with null fill amount                                | Covered |
| Ledger imbalance             | Unit  | `LEDGER_BALANCED`                                                         | Covered |
| Reconciliation rerun         | Unit  | identical deterministic re-eval                                           | Covered |

---

## Compose e2e

| Check                                | Command                                                                                   | Status                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Catalogue wiring                     | `pnpm --filter @csm/e2e test`                                                             | Covered                                                       |
| Bank draw rejection against live sim | `pnpm --filter @csm/e2e test:compose` with `docker compose -f docker-compose.test.yml up` | Partial (skips cleanly if bank URL down; asserts 422 when up) |

---

## Intentionally deferred

1. **Temporal worker kill mid-poll** — TestWorkflowEnvironment time-skipping requires an active worker; shutdown-then-resume hangs. Covered instead by ambiguous draw resolve (single initiate) + history replay.
2. **Temporal server restart mid-workflow** — requires orchestrating Docker Temporal crash/restore with durable history; Documented as deferred rather than stubbed falsely.
3. **Live Schedule double-fire** — only `ScheduleOverlapPolicy.SKIP` is asserted; start two overlapping schedule actions against a real Temporal cluster is not automated here.
4. **Full stack worker+API+Temporal compose failure campaign** — simulators are on `docker-compose.test.yml`; a long multi-service chaos campaign is left for a follow-up job, with unit/provider/Temporal packs covering the failure decision trees.
5. **Blocked/delinquent as bank product flags** — modeled as deterministic failure steps (`HELOC_BLOCKED` / `HELOC_DELINQUENT`) rather than separate account-state machines.

---

## How to run

```bash
# Preferred: failure packs run serially (avoids shared Postgres wipe races)
pnpm test:failure

# Full workspace Vitest (may race DB-backed projects in parallel — use serial packs for adjudication)
pnpm test

# Compose e2e (optional)
docker compose -f docker-compose.test.yml up -d --build
pnpm --filter @csm/e2e test:compose
```
