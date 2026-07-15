# Replay fixtures

Golden Temporal Event Histories (`temporal.api.history.v1.History` **protobuf binary**) for `Worker.runReplayHistory`.

See [docs/temporal-versioning.md](../../../docs/temporal-versioning.md).

| File                           | Workflow                       |
| ------------------------------ | ------------------------------ |
| `monthly-conversion-happy.bin` | `monthlyConversionWorkflow`    |
| `heloc-interest-happy.bin`     | `helocInterestPaymentWorkflow` |
| `manifest.json`                | Index / metadata               |

Regenerate (rare — only after intentional command-path changes):

```bash
pnpm --filter @csm/temporal-workflows generate:replay-fixtures
```

CI:

```bash
pnpm test:replay
```
