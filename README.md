# Canadian Smith Manoeuvre Simulator

Multi-tenant **simulator** for the Canadian Smith Manoeuvre: mortgage principal paydown → HELOC readvance → borrow from HELOC → transfer to brokerage → buy ETF. Orchestration uses **Temporal Schedules and Workflows**. Money is CAD integer cents.

**This does not move real money, provide investment advice, or determine tax outcomes.** HELOC leverage increases debt and interest costs; investments can lose value.

Deep docs live in [`docs/`](./docs/README.md).

---

## How it works

```mermaid
flowchart LR
  UI[Web UI] --> API[API]
  API --> PG[(Postgres)]
  API --> T[Temporal]
  W[Worker] --> T
  W --> Bank[Bank sim]
  W --> Broker[Brokerage sim]
  W --> PG
  Bank -.->|webhooks| API
  Broker -.->|webhooks| API
```

### Monthly conversion (happy path)

1. Strategy is **ACTIVE** → Temporal **Schedule** fires after the expected mortgage payment day (09:00 local).
2. Kickoff starts `monthlyConversionWorkflow` for period `YYYY-MM`.
3. Worker waits until mortgage payment is **settled** and HELOC credit is **readvanced**.
4. Draw amount = min(principal repaid, available HELOC, user cap, platform cap).
5. HELOC draw → transfer to brokerage → deposit → ETF order (idempotent provider calls).
6. Cycle reconciles and lands **Completed** (or Skip / Pause / Fail with reasons).

HELOC **interest** is a separate Schedule/Workflow: charge posts on the HELOC, debit comes from the **ordinary chequing** account (never investment proceeds).

### Main components

| Piece | Role |
| ----- | ---- |
| `apps/api` | Fastify API: auth, strategies, connections, webhooks, ops |
| `apps/worker` | Temporal worker (task queue `smith-manoeuvre`) |
| `apps/bank-simulator` | Mortgage / HELOC / ordinary account + accelerated clock |
| `apps/brokerage-simulator` | Non-registered cash + ETF orders |
| `apps/web` | Customer + operations UI |
| `apps/demo` | Edmonton seed, clock drive, e2e proofs |
| `packages/temporal-workflows` | Deterministic workflows + kickoffs |
| `packages/temporal-activities` | Side-effecting activities (DB + providers) |
| `packages/database` | Prisma / PostgreSQL |

### Money safety (simulation)

- Amounts stored as **bigint cents** (no float money math).
- Provider POSTs use idempotency keys; uncertain transport → resolve before retry (`AMBIGUOUS_RESULT`).
- Temporal Schedule overlap policy **SKIP**; deterministic workflow IDs per tenant/strategy/period.

---

## Prerequisites

- Node.js **20+**
- pnpm **10+** (`packageManager` pinned in root `package.json`)
- Docker + Docker Compose

---

## How to run

### 1. Install

```bash
cp .env.example .env
pnpm install
pnpm db:generate
```

Compose Postgres defaults: user/password/db `smith` / `smith` / `smith_manoeuvre`.

### 2. Start the full stack

```bash
docker compose up --build -d
```

Migrations run via the one-shot `migrate` service before API/worker start.

### 3. Seed the Edmonton demo household

Demo CLIs use the repo `.env` / Compose DB URL (not a stale shell `DATABASE_URL`). Override with `CSM_DATABASE_URL` if needed.

```bash
pnpm --filter @csm/demo seed -- --scenario edmonton-demo
```

### 4. Open the apps

| Service | URL |
| ------- | --- |
| Web | http://localhost:3000 |
| API health / ready | http://localhost:3001/health · `/ready` |
| OpenAPI | http://localhost:3001/docs |
| Bank sim | http://localhost:3002/health |
| Brokerage sim | http://localhost:3003/health |
| Worker health | http://localhost:3100/health |
| Temporal UI | http://localhost:8080 |
| Postgres | `localhost:5432` |
| Temporal gRPC | `localhost:7233` |

### Host-process alternative (optional)

```bash
docker compose up -d postgres temporal temporal-ui
pnpm db:migrate:deploy
pnpm --filter @csm/bank-simulator dev   # :3002
pnpm --filter @csm/brokerage-simulator dev  # :3003
pnpm --filter @csm/api dev              # :3001
pnpm --filter @csm/worker dev           # :3100
pnpm --filter @csm/web dev              # :3000
```

### Stop

```bash
docker compose down          # keep data
docker compose down -v       # wipe Postgres volume
```

---

## Steps to test it

### A. Automated (CI / local)

```bash
pnpm format:check
pnpm lint
pnpm typecheck

# Package suites used in CI-style gates
pnpm test:failure
pnpm test:replay
pnpm test:demo
```

| Command | What it proves |
| ------- | -------------- |
| `pnpm test:demo` | Edmonton happy path + ambiguous HELOC draw (in-process sims + Temporal test env) |
| `pnpm test:replay` | Workflow history replay fixtures still match |
| `pnpm test:failure` | Domain/API/sim failure packs and activity suites |

### B. Manual UI + Temporal (recommended once)

**1. Stack + seed**

```bash
docker compose up --build -d
pnpm --filter @csm/demo seed -- --scenario edmonton-demo
```

**2. Sign in**

1. Open http://localhost:3000 → **Sign in**
2. Household: **Edmonton Demo Household**
3. User: **Pat Edmonton**
4. Role: **Customer** → Dashboard shows **Automation active**

**3. Advance simulators** (mortgage post → settle → HELOC readvance)

```bash
pnpm --filter @csm/demo scenario -- --scenario edmonton-demo --keepAlive
```

Leave this running so settlement jobs keep progressing.

**4. Trigger Temporal now** (do not wait for next scheduled month)

1. Open http://localhost:8080 → **Schedules**
2. Trigger `monthly-conversion-schedule/{tenantId}/{strategyId}`
3. Workflows list should show:
   - `monthlyConversionScheduleKickoff` → **Completed**
   - `monthlyConversionWorkflow` → should progress toward **Completed** after sim time advances

Alternatively:

```bash
docker compose exec temporal temporal schedule trigger \
  --address temporal:7233 -n default \
  --schedule-id 'monthly-conversion-schedule/<tenantId>/<strategyId>'
```

Find `tenantId` / `strategyId` in the seed JSON output or Temporal Schedules list.

**5. Confirm in the UI**

- Dashboard: borrowed / invested ≈ **$770**, **Latest cycle status → Completed**
- **Activity**: period `2026-07` completed
- Sign in as **Operations** → **Cycles** for internal trail / Temporal links

**6. Optional HELOC interest**

```bash
pnpm --filter @csm/demo scenario -- --scenario edmonton-demo --interest --keepAlive
```

Then trigger the `heloc-interest-schedule/...` schedule in Temporal UI.

### C. Onboarding path (without Edmonton seed)

1. Sign in → **Onboarding** → connect bank + brokerage → ETF → cap → disclose → Activate  
2. Schedules appear in Temporal for that strategy  
3. Still need sim mortgage settlement (or Edmonton scenario) before conversion completes  

**Next expected check** on the dashboard is display-only (computed from payment day). To test earlier, **Trigger** the Schedule in Temporal — do not wait for the calendar date.

### Known local gotchas

| Symptom | Fix |
| ------- | --- |
| Login “fetch failed” | Web needs `API_BASE_URL=http://api:3001` in Compose; API `NODE_ENV=development` for `/auth/dev-*` |
| Demo seed auth failed for user `csm` | Demo ignores stale shell `DATABASE_URL`; uses `.env` / Compose `smith:smith` |
| Worker crash `__register_atfork` | Worker image must be glibc (`bookworm-slim`), not Alpine |
| Workflow Failed: Mortgage / HELOC not found | Simulators not loaded/advanced for that strategy — seed + `demo scenario` first |

---

## Monorepo layout

```
apps/
  api/                  # Fastify API + OpenAPI
  worker/               # Temporal worker
  bank-simulator/       # Mortgage / HELOC / ordinary
  brokerage-simulator/  # Brokerage cash + ETF
  web/                  # Next.js customer + ops UI
  demo/                 # Edmonton seed / clock / e2e
  e2e/                  # Compose stack smoke catalogue
packages/
  contracts/            # Zod schemas, env, states
  domain/               # Money, caps, ledger, recon, schedules
  database/             # Prisma + PostgreSQL
  observability/        # Logs, correlation, metrics, telemetry
  temporal-workflows/   # monthlyConversion + helocInterest + kickoffs
  temporal-activities/  # Activities against DB + provider clients
  bank-client/
  brokerage-client/
  test-support/
```

---

## Quality commands

```bash
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

---

## Further reading

| Doc | Topic |
| --- | ----- |
| [`docs/demo.md`](./docs/demo.md) | Manual Edmonton walkthrough |
| [`apps/demo/README.md`](./apps/demo/README.md) | Demo proofs and scenario numbers |
| [`docs/monthly-conversion-workflow.md`](./docs/monthly-conversion-workflow.md) | Conversion state machine |
| [`docs/temporal-schedules.md`](./docs/temporal-schedules.md) | Schedule identity and fire rules |
| [`docs/operations-runbook.md`](./docs/operations-runbook.md) | Health, metrics, resume |
| [`docs/final-audit.md`](./docs/final-audit.md) | Audit findings / remediations |
