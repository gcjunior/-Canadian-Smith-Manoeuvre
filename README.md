# Canadian Smith Manoeuvre Simulator

Multi-tenant automation **simulator** for the Canadian Smith Manoeuvre. It models a readvanceable mortgage, HELOC, ordinary bank account, brokerage account, transfers, and ETF purchases using Temporal Schedules and workflows.

**This does not move real money, provide investment advice, or determine tax outcomes.** HELOC leverage increases debt and interest costs; investments can lose value.

Architecture documentation lives in [`docs/`](./docs/README.md).

## Monorepo layout

```
apps/
  api/                  # Fastify API + OpenAPI
  worker/               # Temporal worker
  bank-simulator/       # Fastify bank / mortgage / HELOC simulator
  brokerage-simulator/  # Fastify brokerage simulator
  web/                  # Next.js UI
packages/
  contracts/            # Zod schemas, env, shared errors
  domain/               # Pure domain helpers (money, caps)
  database/             # Prisma + PostgreSQL
  observability/        # Pino JSON logs, correlation IDs, shutdown
  temporal-workflows/   # Deterministic workflows (scaffold ping only)
  temporal-activities/  # Activities (scaffold only)
  bank-client/
  brokerage-client/
  test-support/
```

Financial conversion/interest workflows are **not** implemented yet (scaffold + docs only).

## Prerequisites

- Node.js 20+
- pnpm 10+
- Docker + Docker Compose

## Installation

```bash
cp .env.example .env
pnpm install
pnpm db:generate
```

## Database migrations

Migrations are applied by an **explicit** command or the Compose `migrate` service. Application containers do **not** race to migrate.

### Host (against local Postgres)

```bash
# Start infrastructure only
docker compose up -d postgres temporal temporal-ui

# Apply migrations
pnpm db:migrate:deploy

# For iterative development migrations:
pnpm db:migrate
```

### Docker Compose (one-shot migrate service)

```bash
docker compose up -d postgres
docker compose up migrate
```

`api` and `worker` depend on `migrate` completing successfully.

## Startup (full stack)

```bash
docker compose up --build -d
```

Browser URLs (localhost):

| Service             | URL                          |
| ------------------- | ---------------------------- |
| Web                 | http://localhost:3000        |
| API health          | http://localhost:3001/health |
| API OpenAPI docs    | http://localhost:3001/docs   |
| Bank simulator      | http://localhost:3002/health |
| Brokerage simulator | http://localhost:3003/health |
| Worker health       | http://localhost:3100/health |
| Temporal UI         | http://localhost:8080        |
| Postgres            | localhost:5432               |
| Temporal gRPC       | localhost:7233               |

Inside the Compose network, services use Docker DNS names (`postgres`, `temporal`, `api`, `bank-simulator`, etc.).

### Host development processes (optional)

```bash
docker compose up -d postgres temporal temporal-ui
pnpm db:migrate:deploy
pnpm --filter @csm/bank-simulator dev
pnpm --filter @csm/brokerage-simulator dev
pnpm --filter @csm/api dev
pnpm --filter @csm/worker dev
pnpm --filter @csm/web dev
```

## Temporal UI

```bash
docker compose up -d temporal temporal-ui
open http://localhost:8080
```

## Tests

```bash
# Unit / package tests
pnpm test

# Optional test infrastructure (Postgres on 5433, Temporal on 7234)
docker compose -f docker-compose.test.yml up -d postgres temporal
docker compose -f docker-compose.test.yml up migrate
```

## Formatting, lint, typecheck

```bash
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
```

## Stopping and deleting local volumes

```bash
# Stop containers
docker compose down

# Stop and delete volumes (destroys local Postgres data)
docker compose down -v

# Test compose
docker compose -f docker-compose.test.yml down -v
```

## Health & readiness

- `/health` — process liveness (JSON)
- `/ready` — dependency readiness where implemented (API checks DB + Temporal)

All services emit **structured JSON logs** via Pino (or Next.js JSON in production containers).
