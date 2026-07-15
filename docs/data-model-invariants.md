# Data model invariants

## Enforced by PostgreSQL (foreign keys / unique constraints)

| Invariant                                                                                        | Mechanism                                                                                   |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Every row belongs to an existing tenant                                                          | `tenant_id` FK → `tenants.id`                                                               |
| User email unique within tenant                                                                  | `@@unique([tenantId, email])`                                                               |
| Connection / account / payment / fill / webhook / idempotency / ledger business event uniqueness | Listed unique constraints in Prisma schema                                                  |
| One monthly conversion cycle per strategy and payment period                                     | `@@unique([tenantId, strategyId, paymentPeriod])`                                           |
| Strategy accounts belong to the **same tenant and same user**                                    | Composite FKs `(accountId, tenantId, userId)` → `financial_accounts (id, tenantId, userId)` |
| Child rows (mortgage, HELOC, etc.) match parent tenant                                           | Composite FKs including `tenantId`                                                          |
| Provider transaction identity where present                                                      | Unique on `(tenantId, …, provider*Id)`                                                      |

## Cannot be enforced by foreign keys alone — domain / application

| Invariant                                                                                                                | Why FK is insufficient                                                                   | Enforced in                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Strategy mortgage account `kind = MORTGAGE` (and HELOC / BANK_OPERATING / BROKERAGE_CASH kinds)                          | FK only checks id identity, not `kind` discriminant                                      | `assertStrategyAccountKinds` in `@csm/domain`; strategy repository create/update              |
| HELOC interest payment must debit `OrdinaryBankAccount` / `BANK_OPERATING` only (never brokerage or HELOC draw proceeds) | Payment FK points at ordinary bank specialty table, but funding provenance is historical | Interest domain rules (later workflow phase); specialty table already excludes brokerage cash |
| Ledger append-only (no amount mutation)                                                                                  | SQL `UPDATE` still possible                                                              | `LedgerRepository.append` only; no update/delete API; ops policy                              |
| Timed-out financial POST must reconcile before new key                                                                   | Cross-request protocol                                                                   | Idempotency + activity layer (later)                                                          |
| Draw amount `min(principal, credit, userCap, platformCap)`                                                               | Derived business math                                                                    | `@csm/domain` `computeDrawAmountCents`                                                        |
| Platform monthly cap                                                                                                     | Config outside strategy row                                                              | Env / platform config in application services                                                 |
| Canadian IANA timezone validity                                                                                          | String column                                                                            | `CanadianTimezone` value object                                                               |
| Payment period format (`YYYY-MM`)                                                                                        | String column                                                                            | `PaymentPeriod` value object                                                                  |
| Balanced multi-leg ledger / reconciliation correctness                                                                   | Multi-row semantic check                                                                 | `evaluateConversionReconciliation` / `evaluateInterestReconciliation` + `verify:ledger` CLI   |
| Optimistic concurrency                                                                                                   | Version column present                                                                   | Repository `update…` requires matching `version` and increments                               |

## Notes

- Full real account numbers and provider credentials are **never** stored; use aliases + simulated `provider*Id` + optional `account_number_last4`.
- Security quantities and prices use `DECIMAL(28, 10)` (Prisma `Decimal`), not IEEE floats.
- All timestamps use `Timestamptz` (UTC storage).
