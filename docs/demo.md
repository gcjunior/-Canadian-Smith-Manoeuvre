# Edmonton demo walkthrough

See also [`apps/demo/README.md`](../apps/demo/README.md).

## Manual walkthrough (visible clock gates)

1. Start infrastructure: `docker compose up -d postgres temporal temporal-ui`
2. Migrate: `pnpm db:migrate:deploy`
3. Start bank + brokerage simulators and (for UI) API + worker + web
4. Seed: `pnpm --filter @csm/demo seed -- --scenario edmonton-demo`
5. Login at http://localhost:3000/login as **Pat Edmonton** (`edmonton-demo` tenant)
6. Dashboard should show waiting / automation active
7. Drive clocks with `pnpm --filter @csm/demo scenario` **or** run Temporal monthly conversion Workflow for the seeded strategy period `2026-07`
8. After completion, dashboard **Latest cycle status** shows **Completed**
9. Interest: post charge via scenario `--interest` / admin, then run HELOC interest Workflow — interest paid total sources from ordinary chequing

## Automated

```bash
pnpm --filter @csm/demo test
```

Evidence screenshots (optional): `DEMO_EVIDENCE=1 pnpm --filter @csm/web test:browser -- e2e/demo-edmonton.spec.ts`
