# Operations runbook

Production-style observability and recovery for the Canadian Smith Manoeuvre simulator.

## Service inventory

| Process                | Default port     | Health            | Ready                              | Metrics                      | Notes                                     |
| ---------------------- | ---------------- | ----------------- | ---------------------------------- | ---------------------------- | ----------------------------------------- |
| API (`apps/api`)       | 3001             | `GET /health`     | `GET /ready` (Postgres + Temporal) | `GET /metrics`               | JWT auth; Temporal Schedules              |
| Worker (`apps/worker`) | HEALTH_PORT 3100 | `GET /health`     | `GET /ready` (Postgres)            | `GET /metrics`, `GET /build` | Temporal Worker identity = build identity |
| Bank simulator         | 3002             | `GET /health`     | `GET /ready`                       | `GET /metrics`               | In-memory provider                        |
| Brokerage simulator    | 3003             | `GET /health`     | `GET /ready`                       | `GET /metrics`               | In-memory provider                        |
| Web (Next.js)          | 3000             | `GET /api/health` | —                                  | —                            | BFF only; no Prisma                       |

Workers advertise `identity` and `SERVICE_VERSION` in `/build` and Temporal Worker registration.

## Structured logs

- JSON stdout via Pino (`message`, `level`, `service`, `version`, `correlationId`).
- Propagate `x-correlation-id` on every HTTP hop (API ↔ simulators ↔ operator scrapes).
- Temporal Schedule / Workflow **memo** carries `correlationId` from activation HTTP through kickoff → child Workflow → Activities → provider clients → DB rows.

### Never log

- Provider tokens / API keys
- JWTs / `Authorization` headers
- Full account numbers
- Raw webhook signing secrets
- Personal tax identifiers (SIN/SSN/TIN)

Redaction is enforced in `@csm/observability` log formatters and `redactObject` for audit payloads.

## OpenTelemetry

Set:

```bash
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
SERVICE_NAME=api|worker|bank-simulator|brokerage-simulator
SERVICE_VERSION=<git sha or semver>
```

When the endpoint is unset, in-process `/metrics` JSON still records counters/histograms for local scrape.

## Metrics catalogue

| Metric                                       | Meaning                                             |
| -------------------------------------------- | --------------------------------------------------- |
| `csm_active_strategies`                      | Gauge of ACTIVE strategies (seeded on Worker start) |
| `csm_cycles_started`                         | Monthly conversion cycles reserved                  |
| `csm_cycles_completed`                       | Cycles reaching COMPLETED                           |
| `csm_cycles_paused`                          | Safety pauses                                       |
| `csm_settlement_wait_duration_ms`            | Mortgage settlement wait                            |
| `csm_heloc_readvance_wait_duration_ms`       | HELOC credit reflection wait                        |
| `csm_transfer_duration_ms`                   | Transfer + deposit confirmation                     |
| `csm_order_fill_duration_ms`                 | Order submit → fill                                 |
| `csm_activity_retries`                       | Temporal Activity attempt > 1                       |
| `csm_ambiguous_provider_outcomes`            | AMBIGUOUS / UNKNOWN provider results                |
| `csm_webhook_duplicates`                     | Duplicate inbound webhooks                          |
| `csm_reconciliation_mismatches`              | Failed recon                                        |
| `csm_interest_payment_failures`              | Interest debit failures                             |
| `csm_schedule_reconciliation_failures`       | Schedule repair failures                            |
| `csm_alerts_fired`                           | Alert emissions by `code`                           |
| `csm_api_requests` / `csm_provider_requests` | HTTP volume                                         |

## Alert codes

Logged as `alert: true` + `alertCode` (also counted on `csm_alerts_fired`).

| Code                         | Trigger                                             | First response                                                                                 |
| ---------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `FINANCIAL_UNKNOWN_STATE`    | AMBIGUOUS / UNKNOWN provider or pause code          | Do **not** re-POST. Resolve via idempotency key + provider GET. Pause strategy if not already. |
| `CYCLE_STUCK`                | Settlement / HELOC / transfer / order timeout codes | Inspect Workflow history, sim clock, provider state; extend poll or resume after clearance.    |
| `RECONCILIATION_MISMATCH`    | Conversion/interest recon FAIL                      | Compare ledger legs vs provider refs; run `verify-ledger` CLI.                                 |
| `LEDGER_IMBALANCE`           | `LEDGER_BALANCED` rule failed                       | Halt further draws; investigate append-only events for the cycle.                              |
| `REPEATED_ACTIVITY_FAILURE`  | Activity attempt ≥ 3                                | Inspect ApplicationFailure type; stop retries for AMBIGUOUS; fix data or circuit.              |
| `INTEREST_DEBIT_FAILURE`     | Ordinary-bank interest debit failed                 | Pause automation if strategy not paused; customer may need manual debit.                       |
| `SCHEDULE_MISSING`           | ACTIVE/PAUSED strategy without Temporal Schedules   | Run schedule reconcile / `repair-schedules` CLI.                                               |
| `CROSS_TENANT_AUTHORIZATION` | Multi-tenant webhook mapping or ownership violation | Invalidate mapping; rotate secrets if needed; audit JWT subject.                               |

Suggested PromQL / Alertmanager rules map 1:1 on `csm_alerts_fired{code="..."}` rate.

### Simulator MVP ops caveat

JSON `/metrics` and structured `emitAlert` logs are implemented. **Prometheus scrape /
Alertmanager paging is not wired in compose.** Treat paging as an external ops concern for
this simulator; do not assume production on-call coverage from this repository alone.

## Correlation path

```text
HTTP x-correlation-id
  → API services / Temporal Schedule memo
  → Schedule kickoff Workflow memo + uuid4 fallback
  → Child Workflow input.correlationId
  → Activity ctx.correlationId
  → bank/brokerage x-correlation-id (+ W3C inject when OTel enabled)
  → DB cycle / ledger / exception / audit correlationId
```

## Incident response (financial)

1. **Identify** — grep logs for `correlationId` or Temporal Workflow id; open Temporal UI.
2. **Classify** — AMBIGUOUS vs business rejection vs recon mismatch (see `docs/failure-model.md`).
3. **Contain** — pause strategy Schedules via ops UI or API; do not force duplicate draws.
4. **Resolve provider** — GET by idempotency key; never blind-retry financial POSTs.
5. **Reconcile** — ensure ledger + recon records match; CLI `verify-ledger` / daily recon report.
6. **Clearance** — ops resume only after written clearance note (ops resume endpoint).
7. **Postmortem** — attach correlation id, workflow ids, alert codes; no secrets in notes.

## Safe restart procedure

### API

1. Drain in-flight HTTP (`SIGTERM` → graceful Fastify close + Temporal connection + Prisma + OTel).
2. Confirm `/ready` on replacement instance (Postgres + Temporal).
3. Webhooks are durable in DB — brief downtime is OK; processor resumes on start.

### Worker

1. `SIGTERM` shuts down Temporal Worker (activities finish or heartbeat timeout per policy).
2. Health server closes; DB disconnects.
3. Start new Worker with same task queue; identity shows on `/build`.
4. Do **not** change task queue mid-flight without draining both Workers.

### Simulators

1. In-memory — restart loses sim state. Prefer scenario re-seed for tests; production simulators should be treated as ephemeral.
2. Confirm `/ready` before pointing Worker traffic.

### Temporal / Postgres

1. Take DB backup before schema changes.
2. Temporal server restart is durable for Workflows; Schedules catch up within catchup window (`3 days`).

## Safe Workflow resume procedure

1. Confirm strategy is `PAUSED` with exception code understood.
2. Confirm **no** in-flight financial mutation is AMBIGUOUS unresolved (query provider by idempotency key).
3. Fix data or provider as needed; append compensating ledger only via supported domain paths.
4. Use ops **resume** with clearance note — recreates/unpauses Schedules; does **not** invent a new draw for a completed period.
5. If a period Workflow failed before cycle COMPLETED, next Schedule trigger / kickoff may start the same period id (idempotent reservation) — verify Temporal history before manual start.
6. Never `signal` “complete” without Activity-backed provider confirmation.

## Schedule reconciliation

- API / CLI repair recreates missing Schedules for ACTIVE/PAUSED strategies.
- Metric/alert `SCHEDULE_MISSING` fires when repair detects absence.
- Overlap policy is `SKIP`; duplicate Schedule fires do not double-draw.

## Health vs readiness

|         | Health                      | Ready                              |
| ------- | --------------------------- | ---------------------------------- |
| Meaning | Process up                  | Dependencies OK to receive traffic |
| API     | DB check (degraded allowed) | DB + Temporal required             |
| Worker  | Always ok if process live   | DB required                        |

## Related docs

- [failure-model.md](./failure-model.md)
- [temporal-schedules.md](./temporal-schedules.md)
- [temporal-versioning.md](./temporal-versioning.md) — determinism, `patched()`, replay fixtures, Worker deploy
- [security-and-tenancy.md](./security-and-tenancy.md)
- [accounting-model.md](./accounting-model.md)
