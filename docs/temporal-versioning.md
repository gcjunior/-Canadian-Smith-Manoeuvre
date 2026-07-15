# Temporal Workflow versioning, determinism & Worker deployment

This document is the source of truth for **safe Workflow evolution** in the Canadian Smith Manoeuvre simulator. It explains every compatibility mechanism we rely on. Do **not** arbitrarily edit finite Workflow command paths; use the mechanisms below and prove safety with replay fixtures.

Related: [ADR-0007](./decisions/0007-one-workflow-per-monthly-cycle.md), [ADR-0008](./decisions/0008-coordinator-vs-schedule-started-cycles.md), [operations-runbook.md](./operations-runbook.md), [failure-model.md](./failure-model.md).

---

## Architecture reminder (why most code is “easy” to version)

We intentionally chose **Schedule-started, finite, per-period Workflows** (Option B in ADR-0008):

| Workflow                           | Lifetime                             | Continue-As-New   |
| ---------------------------------- | ------------------------------------ | ----------------- |
| `monthlyConversionScheduleKickoff` | Seconds                              | No                |
| `monthlyConversionWorkflow`        | Days (bounded waits), then completes | **No (normally)** |
| `helocInterestScheduleKickoff`     | Seconds                              | No                |
| `helocInterestPaymentWorkflow`     | Days (bounded), then completes       | **No (normally)** |

There is **no** long-lived strategy-coordinator entity Workflow in MVP.

---

## Why monthly conversion does **not** normally need Continue-As-New

`ContinueAsNew` exists to cut Event History when a **single** Workflow Execution lives forever or accumulates huge history (entity / monitoring loops).

Monthly conversion does not need it because:

1. **One Workflow Id per payment period** (`monthly-conversion/{tenant}/{strategy}/{YYYY-MM}`) — ADR-0007.
2. **A Temporal Schedule starts that Id** when the calendar fires — ADR-0008 Option B. Strategy life (years) is carried by **Schedules + Postgres**, not one infinite history.
3. **Waits are bounded**: mortgage settlement ≤ 14 days, HELOC credit ≤ 7 days, poll interval 6 hours — history is large but finite and operationally acceptable.
4. **Signals are wake tips only** (small tips; Activities poll providers). We do not append raw webhook payloads into history (see Webhook processor design).
5. Adding Continue-As-New would introduce **cutover risk** (handler drain, compact state) with **no benefit** for calendared periods that already isolate failures and audits per month.

The same rationale applies to `helocInterestPaymentWorkflow` (separate Schedule; one Id per interest period).

Helpers that encode this rationale for tests/docs live in `@csm/temporal-workflows` as `FINITE_WORKFLOW_NO_CONTINUE_AS_NEW_RATIONALE`.

---

## Compatibility mechanisms (explain every one)

### 1. Deterministic Workflow code + Activity boundaries

Workflows may only use Temporal Workflow APIs and deterministic logic. All I/O (DB, bank/brokerage HTTP) lives in Activities. Reordering or adding await-points that schedule Temporal **commands** changes history.

### 2. Golden Event History replay fixtures (CI)

Committed under `packages/temporal-workflows/replay-fixtures/`:

- `monthly-conversion-happy.bin` (protobuf binary Event History)
- `heloc-interest-happy.bin`
- `manifest.json`

Store fixtures as **protobuf binaries** (not hand-edited JSON): `JSON.stringify(fetchHistory())` does not produce Temporal Web/CLI JSON and breaks `historyFromJSON`.

CI command:

```bash
pnpm test:replay
```

This runs `Worker.runReplayHistory` against current Workflow source. A **DeterminismViolationError** means the change is incompatible with stored histories.

Regenerate **only** after intentional command-path changes (and after reviewing this doc):

```bash
pnpm --filter @csm/temporal-workflows generate:replay-fixtures
# requires UPDATE_REPLAY_FIXTURES=1 (set by the npm script)
```

### 3. TypeScript Patching API (`patched` / `deprecatePatch`)

TypeScript does **not** use Java’s `getVersion`. Use:

| API                       | Role                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `patched(patchId)`        | New executions record a marker and take the new branch; replays of **pre-patch** histories take the old branch |
| `deprecatePatch(patchId)` | After no pre-patch Workers/runs remain in retention, mark the patch deprecated, then later remove it           |

Wrappers (Workflow-only): `gatedPatch` / `gatedDeprecatePatch` in `packages/temporal-workflows/src/versioning/compat-gates.ts`.

**Do not** call `patched` preemptively. Only introduce a patch id when a real divergence lands. Naming: `csm.<workflow>.<yyyy-mm-dd>.<slug>` (see `WORKFLOW_CHANGE_IDS`).

Lifecycle:

1. Deploy Worker with `if (patched('id')) { new } else { old }`.
2. Wait until all open executions that need `old` have completed (and retention covers replays you still care about).
3. Deploy with `deprecatePatch('id')` + only `new` path.
4. After retention clears old histories, remove the patch call entirely.

### 4. Finite period Ids + Schedule isolation (deploy-friendly versioning)

Because each period is a **new** Workflow Id, many Product changes can ship as “new periods only” without patching **if** you accept that mid-flight month Workflows keep the old Worker binary’s behavior until they complete.

Safe when mid-flight code must not change: keep old Workers until in-flight period Workflows finish (Worker Versioning / dual deploy). If mid-flight must change, use `patched`.

### 5. Worker build / identity metadata

| Field                     | Source                             | Where visible                   |
| ------------------------- | ---------------------------------- | ------------------------------- |
| `SERVICE_VERSION`         | Env                                | Logs, `/build`                  |
| Worker `identity`         | `createBuildInfo`                  | Temporal Worker list, `/build`  |
| `WORKFLOW_BUNDLE_VERSION` | `@csm/temporal-workflows` constant | Logs, Worker `/health` `/build` |

Bump `WORKFLOW_BUNDLE_VERSION` when shipping intentional Workflow behavior changes that need an ops trail. It is **not** a Temporal patch id.

### 6. Worker Versioning (server feature) / dual deployment (ops policy)

For incompatible binary transitions without patching mid-flight histories:

1. Keep **old Worker** deployment serving the task queue until in-flight finite Workflows complete (or use Temporal Worker Versioning Build IDs when enabled in the cluster).
2. Roll **new Worker** for new Schedule-started Ids.
3. Drain old Worker only after visibility shows no open runs needing old code.

MVP default: single task queue + carefully gated patches + finite Ids. Document dual-run when a change cannot be patched easily.

### 7. Continue-As-New policy (future long-lived Workflows only)

If we ever introduce an entity/monitoring Workflow, use `shouldContinueAsNew` + `assertCompactContinueAsNewState`:

1. Check `workflowInfo().continueAsNewSuggested` **and** history length/size thresholds (`classifyHistoryPressure`).
2. Ensure **Signal/Update handlers are idle** (no mid-handler Activities).
3. Ensure children are settled or explicitly abandoned.
4. Pass **compact** checkpoint state only (ids/cursors — never webhook bodies, JWTs, tokens, raw payloads).
5. Call `continueAsNew` with that compact input.

Helpers: `packages/temporal-workflows/src/versioning/continue-as-new-policy.ts`.

### 8. History-size monitoring

| Layer                   | Mechanism                                                                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Temporal Server (≥1.20) | `continueAsNewSuggested`, `historyLength`, `historySize` on `workflowInfo()`                                                                                                 |
| Code helpers            | `summarizeHistoryPressure` for future entity Workflows / Queries                                                                                                             |
| Finite Workflows        | Do **not** add an Activity at end “just to report size” — that would alter command paths and break fixtures. Monitor via Temporal UI, visibility, and Worker metrics instead |
| Threshold defaults      | Warn ~8k events / 40MiB; critical ~10k / 50MiB or server suggestion                                                                                                          |

### 9. Replay-breaking vs usually-safe changes

**Break replay if ungated on an existing path:**

1. Adding or removing Activity calls
2. Changing timer ordering / durations that are awaited
3. Changing conditional command paths
4. Reordering awaited Temporal operations (Activities, Timers, Conditions, children)

**Usually safe (still run `pnpm test:replay`):**

- Activity implementation-only changes
- Additive Query handlers (no commands)
- Logs/metrics inside Activities
- Behavior that only affects **new** Schedule-started Workflow Ids

Catalogue encoded in `REPLAY_BREAKING_CHANGE_CLASSES` / `REPLAY_SAFE_CHANGE_CLASSES` (compatibility tests).

---

## Safe changes policy (checklist)

Before merging Workflow edits:

1. [ ] Classify: implementation-only vs command-path change.
2. [ ] If command-path and mid-flight runs exist → introduce `patched(id)` with old+new branches.
3. [ ] If only new periods matter → confirm open runs tolerated; otherwise dual Worker.
4. [ ] Run `pnpm test:replay` — must pass.
5. [ ] If golden histories must advance (after gated cutover), regenerate fixtures with `generate:replay-fixtures` and review the JSON diff.
6. [ ] Bump `WORKFLOW_BUNDLE_VERSION` when behavior intentionally changes.
7. [ ] Never store secrets or full provider payloads in Workflow input/memo/signals.

---

## Worker deployment procedure

1. **Build** Worker image with `SERVICE_VERSION=<git sha>` and matching `@csm/temporal-workflows` bundle.
2. **Preflight**: `GET /ready` on Worker health port; `GET /build` shows `identity` + `workflowBundleVersion`.
3. **Rollout**:
   - Patch-compatible change: rolling update ok.
   - Incompatible without patch: run old+new Workers (or Build-ID Worker Versioning) until old runs drain.
4. **Verify**: Temporal UI — no sticky sticky-task failures / non-determinism; `pnpm test:replay` in CI green.
5. **Rollback**: redeploy previous Worker image; finite incomplete period Workflows resume on compatible binary.

Graceful stop: `SIGTERM` shuts down Worker (see [operations-runbook.md](./operations-runbook.md)).

---

## CI

| Command                                                          | Purpose                                            |
| ---------------------------------------------------------------- | -------------------------------------------------- |
| `pnpm test:replay`                                               | Replay golden histories + compatibility unit tests |
| `pnpm --filter @csm/temporal-workflows test`                     | Full Workflow suite including live TestEnv replays |
| `pnpm --filter @csm/temporal-workflows generate:replay-fixtures` | Refresh fixtures (manual / rare)                   |

Wire `pnpm test:replay` into the pipeline on every PR that touches `packages/temporal-workflows/**` or Worker Workflow wiring.

---

## Explicit non-goals

- Arbitrarily inserting `patched()` with no behavioral change.
- Continue-As-New on monthly/interest finite Workflows “just in case”.
- Storing Event History bodies in Postgres application tables (Temporal owns history).
