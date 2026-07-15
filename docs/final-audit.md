# Final Principal-Engineer Audit

**Repository:** Canadian Smith Manoeuvre automation **simulator**  
**Audit date:** 2026-07-15  
**Scope:** Full monorepo (apps + packages + docs + compose + demo)  
**Mode:** Read-only inspection first; Critical/High remediation follows this report

---

## Executive verdict

This codebase is a **serious multi-tenant Temporal simulator MVP** with unusually strong money-safety _intent_ (integer CAD cents, idempotency keys, ambiguous-timeout resolve path, HMAC webhooks, tenant-scoped repositories, Schedule `SKIP`, deterministic period Workflow IDs, Edmonton demo proofs, Temporal replay fixtures).

**It is not production-ready for real money.** Product non-goals forbid real bank/brokerage rails. Sims are in-memory. Several Critical/High defects remain in mutation retry classification, transfer provenance, secret defaults, onboarding/sim dual-write, and CI/ops wiring.

Nothing in this report, after remediation, should be read as certification for capital markets execution.

---

## Strengths (keep these)

| Area                                        | Evidence                                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Layer boundaries                            | Web depends only on `@csm/contracts` + Next; workflows do not import activity implementations           |
| Money core                                  | Domain/contracts use `bigint` cents; quantities as decimal strings                                      |
| Ambiguous timeout (abort / `504+processed`) | Clients throw `AMBIGUOUS_RESULT`; Workflows call `resolveAmbiguous*`; Edmonton ambiguous-draw e2e       |
| Idempotency                                 | Stable `mc:{tenant}:{strategy}:{period}:{op}` keys; DB unique; simulators hash payloads                 |
| Caps / pause                                | `computeDrawAmountCents` min of four inputs; strategy pause + Schedules                                 |
| Tenancy                                     | Repos take `tenantId`; ownership checks in strategy snapshot; webhook refuses multi-tenant external IDs |
| Webhooks                                    | Raw-body HMAC-SHA256 + timing-safe compare; SKIP LOCKED processor                                       |
| Schedules                                   | `ScheduleOverlapPolicy.SKIP`; deterministic Workflow IDs; unique `(tenant, strategy, paymentPeriod)`    |
| Logging redaction                           | Pino `formatters.log` → `redactObject`                                                                  |
| Demo proofs                                 | `apps/demo` happy path + `TIMEOUT_AFTER_SUCCESS` draw                                                   |
| Temporal versioning                         | Replay fixtures + `pnpm test:replay` + versioning doc                                                   |

---

## Severity-ranked findings

### Critical

#### C1 — Financial POSTs can Temporal-retry on uncertain 5xx / transport failures

**Evidence**

- `packages/bank-client/src/errors.ts`: `502|503|504` → `PROVIDER_UNAVAILABLE` (retryable) unless specially handled.
- `packages/bank-client/src/http.ts`: only AbortError or `504`+`processed:true` → `AMBIGUOUS_RESULT`; other transport failures → `RETRYABLE_TRANSPORT`.
- `packages/temporal-activities/src/shared/errors.ts`: those kinds map to **retryable** Activity failures.
- `packages/temporal-workflows/src/monthly-conversion/constants.ts`: `financialMutation.maximumAttempts: 3`; only `AMBIGUOUS_RESULT` is non-retryable among mutation outcomes.
- On retry, `initiateHelocDraw` / transfer / order re-POST when intention exists **without** `providerTransactionId`.
- Contravenes `docs/failure-model.md` (“do not re-POST; resolve by idempotency key”).

**Why it matters**  
A gateway timeout or connection drop after the provider accepted a draw can cause a second POST. Idempotency keys mitigate _if_ the provider recorded the first request; the failure model requires GET-first precisely when that is uncertain.

**Remediation**

1. During `financialMutation`, classify uncertain outcomes (502/503/504, post-send transport failure) as `AMBIGUOUS_RESULT`.
2. Before any financial POST: if an intent row exists, GET by idempotency key first; POST only when definitively absent.
3. Set Temporal `financialMutation.maximumAttempts: 1` (or allow retries only for pre-flight validation).

---

#### C2 — No CI/CD pipeline enforcing safety gates

**Evidence**

- No `.github/` workflows in the repository.
- Root scripts define `test`, `test:failure`, `test:replay`, `test:demo` (`package.json`) but nothing runs them on PR.
- `docs/temporal-versioning.md` instructs wiring `pnpm test:replay` into the pipeline.

**Why it matters**  
Determinism, tenancy, failure packs, and Edmonton proofs can regress without a merge gate.

**Remediation**  
Add PR CI: install → typecheck/lint → `pnpm test:failure` → `pnpm test:replay` → `pnpm test:demo` (with Postgres service).

---

### High

#### H1 — Transfer posts from HELOC while ledger assumes ordinary bank

**Evidence**

- `packages/temporal-activities/src/transfer/activities.ts`: MM + provider POST use `helocAccountId` / `helocProviderId` as source.
- `packages/domain/src/ledger/event-ids.ts` and monthly Workflow ledger append debit **ordinary bank** for the transfer leg.
- `docs/accounting-model.md`: draw clears through bank operating, then bank → brokerage.

**Why it matters**  
Provider cash path, money-movement trail, and ledger diverge. Recon checks amounts, not account kinds on the transfer leg — provenance for tax-deductible investment debt can be wrong; real banks often reject HELOC→brokerage rails.

**Remediation**  
Transfer source = ordinary bank provider/account IDs. Add recon assertions on movement account kinds.

---

#### H2 — Insecure JWT / webhook secret defaults usable in production misconfig

**Evidence**

- `packages/contracts/src/env.ts`: defaults `local-dev-jwt-signing-secret` / `local-dev-webhook-secret`.
- No refuse-defaults gate when `NODE_ENV=production`.

**Why it matters**  
Forged Bearer tokens and forged webhooks → cross-tenant wakeups / ops impersonation.

**Remediation**  
Fail API/simulator startup in production if secrets equal defaults or fall below entropy floor.

---

#### H3 — `providerAccountId` not globally unique; webhook lookup is cross-tenant

**Evidence**

- Prisma: unique `(tenantId, connectionId, providerAccountId)` only (`schema.prisma` FinancialAccount).
- `apps/api/src/services/webhook-app-service.ts`: `findAccountsByProviderAccountId` without tenant; multi-match correctly fails, single wrong mapping still routes.

**Why it matters**  
Shared/collide-able external IDs (especially invented `sim-*` strings) can route events to the wrong tenant.

**Remediation**  
Global unique on `providerAccountId` (UUIDs from simulators) or `(providerType, providerAccountId)`; keep multi-tenant collision denial.

---

#### H4 — Web onboarding invents provider IDs and never provisions simulators

**Evidence**

- `apps/api/src/services/connection-app-service.ts`: creates DB rows with `sim-mortgage-*` etc.; no HTTP to bank/brokerage sims.
- `apps/api/src/app.ts`: bank/brokerage clients injected then voided for connections.
- Contrast: `apps/demo/src/seed.ts` dual-writes simulator UUIDs into Postgres.

**Why it matters**  
UI onboarding looks complete; Temporal Activities cannot drive money against nonexistent provider resources. Only the demo path works end-to-end.

**Remediation**  
Orchestrate: load scenario → create simulator accounts → persist matching `providerAccountId`s (same as demo seed).

---

#### H5 — Failure-model docs describe `ProviderOperation` / `TIMED_OUT_NEEDS_RECONCILE`; runtime uses MoneyMovement + AMBIGUOUS

**Evidence**

- `docs/failure-model.md`, `docs/system-architecture.md` refer to `ProviderOperation` and `TIMED_OUT_NEEDS_RECONCILE`.
- Schema MoneyMovement states: `REQUESTED|PENDING|SETTLED|FAILED|UNKNOWN|REVERSED`.
- On ambiguous POST, intentions often remain `REQUESTED` without `providerTransactionId`.

**Why it matters**  
Operators follow incomplete runbooks; ambiguous state is not a first-class persisted outcome.

**Remediation**  
Mark intent `UNKNOWN` when classifying ambiguous; update failure-model docs to match.

---

#### H6 — Ops / test pyramid gaps (compose apex, alerts wiring, replay coverage)

**Evidence**

- `docker-compose.test.yml`: Postgres + Temporal + sims only — **no API/worker**.
- `apps/e2e` compose test probes bank health only.
- Observability: JSON `/metrics` + `emitAlert` logs; no Prometheus/Alertmanager rules in compose.
- Replay fixtures: happy-path bin only (`packages/temporal-workflows/replay-fixtures/`).

**Why it matters**  
Claims of “ops ready” / safe Worker deploy lack automated full-path and paging evidence.

**Remediation**  
CI compose job with services; expand golden replay over time; wire metrics export or document as simulator-only ops. CI gate for failure/replay/demo closes the highest risk gap for H6.

---

### Medium

| ID  | Title                                                           | Evidence summary                                                                         |
| --- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| M1  | Schedule anchors duplicated domain vs workflow isolate          | `domain/.../monthly-payment-schedule.ts` vs `temporal-workflows/.../schedule-anchors.ts` |
| M2  | Activity retry policies triplicated without equality test       | `retry-policies.ts` vs workflow `constants.ts` (monthly + interest)                      |
| M3  | `recordOperation` / audit metadata not idempotent               | `cycle/activities.ts`, `audit/activities.ts`                                             |
| M4  | HelocCreditEvent lacks unique `(tenant, heloc, period)`         | `schema.prisma`, `calculateNewlyAvailableCredit` race                                    |
| M5  | No ESLint import-boundary enforcement; web lint ignored         | `eslint.config.js`                                                                       |
| M6  | Web money input uses IEEE floats for caps                       | `apps/web/src/lib/money.ts`, OnboardingWizard                                            |
| M7  | Ledger package append not one DB transaction                    | `audit/activities.ts` per-leg loop                                                       |
| M8  | Colon-dense idempotency keys near 128-char limit                | `helpers.ts` idempotencyKey; deposit `:deposit` suffix                                   |
| M9  | `TENANT_SCOPE_VIOLATION` not Temporal non-retryable             | workflow activity options                                                                |
| M10 | No PostgreSQL RLS (app-layer only)                              | `docs/security-and-tenancy.md`                                                           |
| M11 | Simulator `/sim/admin` unauthenticated; webhook URL env-driven  | bank/brokerage admin routes                                                              |
| M12 | Activity “integration” uses FakeBank, not HTTP sims             | `temporal-activities/.../integration`                                                    |
| M13 | Ops repair CLIs untested                                        | `verify-ledger`, `repair-schedules`                                                      |
| M14 | README/architecture docs drift (scaffold claims, package names) | root README, system-architecture C4                                                      |

### Low

| ID  | Title                                                                     |
| --- | ------------------------------------------------------------------------- |
| L1  | Catch-up + SKIP can skip a calendar fire during long-running prior Action |
| L2  | Terminal recon re-read returns empty items                                |
| L3  | Demo harness uses non-deterministic Workflow IDs (prod path does not)     |
| L4  | Playwright / DEMO_EVIDENCE not in CI                                      |
| L5  | Patch helpers unused until first command-path change                      |
| L6  | ADMIN role broad bypass if signing secret compromised                     |

---

## Remediation plan (ordered)

### Phase A — Critical / High (this remediation cycle)

1. **C1** — Ambiguous classification + GET-before-POST + `maximumAttempts: 1` for financial mutations.
2. **C2** — Add GitHub Actions CI workflow.
3. **H1** — Transfer source = ordinary bank end-to-end.
4. **H2** — Refuse default secrets when `NODE_ENV=production`.
5. **H3** — Migration: unique `providerAccountId` globally (UUIDs).
6. **H4** — Wire simulated connect to provision bank + brokerage simulators with matching IDs.
7. **H5** — Persist `UNKNOWN` on ambiguous; align `docs/failure-model.md`.
8. **H6** — CI gates (failure + replay + demo); runbook note that Prometheus/Alertmanager is out-of-band for simulator MVP.

### Phase B — Medium (next iterations)

- Deduplicate schedule anchors + retry policy lockstep test.
- Audit/credit-event idempotency; ledger multi-insert transaction.
- Web decimal money parse; RLS; sim admin auth; HTTP activity integration; CLI smokes; README refresh.

### Phase C — Before any _real_ financial integration

Not optional product work — separate system/program (see below).

---

## Missing tests

| Gap                                                             | Why                           |
| --------------------------------------------------------------- | ----------------------------- |
| Full-stack compose cycle (API + Worker + Temporal + DB + sims)  | Apex of architecture pyramid  |
| CI gate for failure + replay + demo                             | Prevent regressions           |
| Golden replay: PAUSED / ambiguous-draw / interest NSF histories | Safe Worker deploy            |
| Worker kill mid-draw + resume (live Temporal)                   | Durability proof beyond stubs |
| Live Schedule double-fire on real Temporal                      | Overlap policy evidence       |
| CLI smokes for `verify:ledger` / `repair:schedules`             | Ops repair safety             |
| Activities against live HTTP sims (not FakeBank)                | Wire realism                  |
| Property tests for draw-cap min permutations                    | FR-3 edges                    |
| Transfer source-kind recon assertion                            | H1 regression lock            |
| Financial mutation: 502/plain-504 never re-POSTs                | C1 regression lock            |
| Production env rejects default JWT/webhook secrets              | H2 regression lock            |

---

## MVP launch checklist (simulator only)

**Must before calling this a shippable simulator MVP**

- [ ] CI green: typecheck, lint, `test:failure`, `test:replay`, `test:demo`
- [ ] C1–H5 remediations merged
- [ ] Edmonton happy + ambiguous proofs green
- [ ] Explicit disclosure on login/dashboard: leverage / borrowed HELOC / simulator
- [ ] Runbook drill: ambiguous draw → pause → GET-by-key → resume with clearance note
- [ ] Default secrets rejected in `NODE_ENV=production`
- [ ] Onboarding provisions simulators (or onboarding disabled with demo-only seed path)
- [ ] README and acceptance criteria match implemented workflows
- [ ] Operator knows sims lose state on restart

**Explicitly out of MVP**

- [ ] Real banking / brokerage certification
- [ ] Prometheus/Alertmanager paging stack (optional Phase B)
- [ ] PostgreSQL RLS
- [ ] Live chaos (worker kill / Temporal bounce)
- [ ] Legal/tax advice productization

---

## Before real financial integrations

Do **not** extend this simulator into production money movement by swapping URLs. Real rails require a **separate program** (new ADRs), including at least:

### Legal & compliance

- Securities / advice boundaries (IIROC / provincial), tax-deductibility guidance disclaimers reviewed by counsel
- Canadian privacy (PIPEDA / Law 25 where applicable): DPIA, retention, access/deletion
- Clear customer agreements for HELOC leverage, margin/liquidation risk, and automation agency

### Security

- Production IdP (not forgable JWT roles), secret manager, HSM/KMS for signing
- Penetration test, threat model (STRIDE), SSRF allowlists, admin network controls
- Dependency SCA + SBOM; pinned SLSA provenance for Worker images

### Provider certification

- Formal bank/brokerage partner sandboxes with **certified** idempotency contracts
- Timeout/ambiguous SLAs in writing; draw/transfer rails matching ledger (ordinary bank funding)
- Production webhook IP allowlists, mutual TLS or signed keys rotated

### Privacy / tenancy

- RLS or equivalent; cryptographic isolation; audit of every ADMIN ops action
- PII minimization; no full account numbers; redaction verified under load

### Operations

- Multi-AZ Temporal + Postgres backups / PITR; proven restore drills
- Alerting → on-call with SLO burn alerts for stuck cycles and ambiguous outcomes
- Dual Worker versioning playbooks; canary; kill switches that pause all Schedules
- Chaos certification of at-most-once financial mutations under crash

### Engineering

- Replace in-memory sims with partner adapters behind the same clients
- Full-stack CI against partner sandboxes; contract tests for every mutation
- Independent security review of money paths before first live draw

Until that program completes, this repository remains a **deterministic training / design / demo simulator**.

---

## Remediation status

| Finding                             | Status                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| C1 Ambiguous 5xx / transport        | Fixed — financialMutation → AMBIGUOUS_RESULT; GET-before-POST; `maximumAttempts: 2`              |
| C2 No CI                            | Fixed — `.github/workflows/ci.yml` (typecheck, lint, failure, replay, demo)                      |
| H1 Transfer HELOC source            | Fixed — ordinary bank `bankAccountId` / `bankProviderId`                                         |
| H2 Insecure secret defaults         | Fixed — refuse defaults / short secrets when `NODE_ENV=production`                               |
| H3 providerAccountId uniqueness     | Fixed — global `@@unique([providerAccountId])` + migration                                       |
| H4 Onboarding never provisions sims | Fixed — `ConnectionAppService` dual-writes sim admin accounts                                    |
| H5 Failure-model vocabulary         | Fixed — docs + persist `UNKNOWN` on ambiguous intents                                            |
| H6 Ops/test pyramid                 | Partially — CI gates + runbook caveat; compose apex / Alertmanager still open (Medium follow-up) |
| Medium / Low                        | Tracked for follow-up                                                                            |

### Validation suite results (2026-07-15)

| Gate                                  | Result                                            |
| ------------------------------------- | ------------------------------------------------- |
| `pnpm typecheck`                      | Pass                                              |
| `pnpm lint`                           | Pass                                              |
| `pnpm test:failure`                   | Pass (domain through temporal-workflows packs)    |
| `pnpm test:replay`                    | Pass                                              |
| `pnpm test:demo`                      | Pass (Edmonton happy + ambiguous draw)            |
| `pnpm --filter @csm/bank-client test` | Pass (includes 503 → AMBIGUOUS)                   |
| `pnpm --filter @csm/contracts test`   | Pass (production secret refuse + CREATED→UNKNOWN) |

**Still not production-ready for real money.** Critical/High simulator MVP defects above are addressed; legal, provider certification, privacy, compliance, RLS, chaos, and paging remain open (see “Before real financial integrations”).
