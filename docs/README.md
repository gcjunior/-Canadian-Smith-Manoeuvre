# Documentation Index

Architecture documentation for the **Canadian Smith Manoeuvre automation simulator**. Application implementation follows these docs; Phase 0 tooling already exists in the monorepo.

## Core docs

| Document                                                           | Description                                                                                   |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| [product-requirements.md](./product-requirements.md)               | Goals, non-goals, personas, FRs/NFRs, risk copy                                               |
| [system-architecture.md](./system-architecture.md)                 | Bounded contexts, containers, data, idempotency, reconcile, testing, monorepo, MVP acceptance |
| [monthly-conversion-workflow.md](./monthly-conversion-workflow.md) | Schedule → settle → draw → invest → reconcile                                                 |
| [heloc-interest-workflow.md](./heloc-interest-workflow.md)         | Separate interest charge + ordinary-bank debit                                                |
| [security-and-tenancy.md](./security-and-tenancy.md)               | Tenant isolation, authz, webhooks, secrets                                                    |
| [failure-model.md](./failure-model.md)                             | Failure taxonomy, timeout reconcile, recovery                                                 |
| [domain-glossary.md](./domain-glossary.md)                         | Shared vocabulary                                                                             |
| [data-model-invariants.md](./data-model-invariants.md)             | FK vs domain invariants for the Prisma model                                                  |
| [decisions/](./decisions/)                                         | Architecture Decision Records                                                                 |

## Mermaid diagram map

| Diagram                   | Location                       |
| ------------------------- | ------------------------------ |
| System context            | system-architecture.md §2      |
| Container architecture    | system-architecture.md §4      |
| Local Docker              | system-architecture.md §17     |
| Monthly workflow          | monthly-conversion-workflow.md |
| Transfer sequence         | monthly-conversion-workflow.md |
| Interest-payment workflow | heloc-interest-workflow.md     |
| Reconciliation sequence   | system-architecture.md §11     |
| Failure recovery          | failure-model.md               |
| Tenant isolation          | security-and-tenancy.md        |

## ADR highlights

- Schedules over OS cron (**0001**)
- Poll every 6h + optional webhook Signal (**0002**)
- Independent Schedule-started monthly workflows — **not** a long-lived coordinator (**0008**)
- Deterministic workflow ids enforce one cycle per strategy/period (**0009**)

## Explicit non-goals (reminder)

Real bank/brokerage integration · investment advice · tax determination · rebalancing · dividend recycling · capitalizing HELOC interest · real-money execution.
