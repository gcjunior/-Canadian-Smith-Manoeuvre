# Demo evidence

Automated Temporal + simulator proofs:

```text
pnpm --filter @csm/demo test
```

Expected:

- `edmonton-demo.e2e.test.ts` — gates, uniqueness, ledger, Completed, interest from ordinary
- `edmonton-ambiguous-draw.e2e.test.ts` — TIMEOUT_AFTER_SUCCESS draw; single POST via idempotency resolve

Playwright dashboard screenshot (optional, requires API + web + Completed cycle):

```bash
DEMO_EVIDENCE=1 pnpm --filter @csm/web test:browser -- e2e/demo-edmonton.spec.ts
```

Writes `edmonton-dashboard-completed.png` here when the Edmonton household cycle is Completed.
