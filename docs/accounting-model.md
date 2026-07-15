# Accounting model — append-only ledger

This document explains how Canadian Smith Manoeuvre conversion and HELOC interest
are recorded in the **append-only accounting ledger**, and how that ledger stays
separate from **simulated provider records** (bank/brokerage simulators).

## Design principles

1. **Append-only.** Posted ledger rows are never updated or deleted.
2. **Balanced packages.** Every conversion or interest package posts equal total
   debits and credits (CAD cents).
3. **Stable `businessEventId`.** Retries use the same ids → append is idempotent
   (success-if-same payload).
4. **Compensating entries.** Mistakes are corrected by posting a new reversing
   leg (`reversesBusinessEventId`), not by mutating history (ADR-0006).
5. **Chart categories** on each row: `ASSET`, `LIABILITY`, `EQUITY`, `INCOME`,
   `EXPENSE`, `CLEARING` (derived from product account kind at post time).
6. **Provider refs are labels**, not double-entry accounts. Simulator transaction
   ids live in `providerRefType` / `providerRefId` (and in `MoneyMovement` /
   order tables). The ledger does not store raw provider payloads.
7. **Scope.** Conversion rows carry `cycleId` + `strategyId`. Interest rows carry
   `interestCycleId` + `strategyId`.

## Product accounts → categories

| Product account kind | Category  | Role                                         |
| -------------------- | --------- | -------------------------------------------- |
| `MORTGAGE`           | LIABILITY | Outstanding mortgage principal               |
| `HELOC`              | LIABILITY | HELOC balance drawn                          |
| `BANK_OPERATING`     | ASSET     | Ordinary chequing (interest pay + clearing)  |
| `BROKERAGE_CASH`     | ASSET     | Non-registered cash                          |
| `BROKERAGE_POSITION` | ASSET     | ETF holdings (MVP may share cash account id) |

Simulated provider tables (`MortgagePayment`, `MoneyMovement`, deposits, orders,
fills, interest charges/payments) are **operational truth from the bank/broker
sim**. The ledger is the **internal accounting trail** built from reconciled
facts.

---

## Worked example — \$770 conversion

Assume a monthly cycle where the settled mortgage payment includes **\$770.00**
of principal (77 000 CAD cents). That principal unlocks \$770 of HELOC credit,
which is drawn and fully invested in the ETF. No brokerage deposit fees apply
(MVP supported fee = \$0).

### Provider facts (simulator / operations)

| Step | Provider fact                     | Amount   |
| ---- | --------------------------------- | -------- |
| 1    | Mortgage payment SETTLED          | …        |
| 2    | Principal repaid                  | \$770.00 |
| 3    | HELOC credit for payment period   | \$770.00 |
| 4    | HELOC draw SETTLED                | \$770.00 |
| 5    | Bank → brokerage transfer SETTLED | \$770.00 |
| 6    | Brokerage deposit SETTLED         | \$770.00 |
| 7–8  | Investment order FILLED + fill    | \$770.00 |
| 9    | Remaining brokerage cash          | \$0.00   |

### Ledger package (balanced)

Stable ids: `conversion:{cycleId}:{leg}`.

| #   | businessEventId suffix      | Account        | Category  | Dir    | Amount |
| --- | --------------------------- | -------------- | --------- | ------ | ------ |
| 1   | `heloc-draw:debit`          | HELOC          | LIABILITY | DEBIT  | 770.00 |
| 2   | `heloc-draw:credit`         | BANK_OPERATING | ASSET     | CREDIT | 770.00 |
| 3   | `brokerage-transfer:debit`  | BANK_OPERATING | ASSET     | DEBIT  | 770.00 |
| 4   | `brokerage-transfer:credit` | BROKERAGE_CASH | ASSET     | CREDIT | 770.00 |
| 5   | `investment:debit`          | BROKERAGE_CASH | ASSET     | DEBIT  | 770.00 |
| 6   | `investment:credit`         | BROKERAGE\_\*  | ASSET     | CREDIT | 770.00 |

**Totals:** debits = \$2 310.00, credits = \$2 310.00 → **balanced**.

Reading the story:

1. Drawing the HELOC increases the HELOC liability and parks proceeds in the
   ordinary bank (clearing path).
2. Transferring to brokerage moves the asset from ordinary bank to brokerage cash.
3. Buying the ETF spends brokerage cash and records the investment asset.
4. Remaining cash of \$0 is recorded explicitly on the reconciliation item
   `REMAINING_CASH_RECORDED` (no zero-amount ledger row).

Mortgage principal reduction itself is evidenced by the settled provider
payment and recon checks `MORTGAGE_PAYMENT_SETTLED` / `PRINCIPAL_POSITIVE`; it
is not duplicated as a second ledger mutation of mortgage balance in MVP
(provider + recon remain the proof for that fact).

### Reconciliation checks (conversion)

After the ledger package posts, `reconcileCycle` evaluates:

1. Settled mortgage payment exists
2. Principal amount is positive
3. HELOC credit event is associated with the mortgage period
4. HELOC draw ≤ calculated investment / newly available credit
5. Brokerage transfer matches the HELOC draw
6. Brokerage deposit matches the transfer (supported fees only; MVP fee = \$0)
7. Investment order notional ≤ settled brokerage deposit cash
8. Fill belongs to the expected order, account, and symbol
9. Remaining cash is explicitly recorded (including zero)
10. No provider transaction is already linked to another cycle
11. No money movement crosses tenant or user boundaries

Plus integrity: **ledger debits = ledger credits**.

Repeated reconciliation is idempotent: a terminal `PASSED` / `FAILED` row is
returned without rewriting items.

---

## Interest example (separate workflow)

Interest is never paid from HELOC draw proceeds or brokerage. Example interest
charge of \$120.00:

| Leg                              | Account        | Dir    | Amount |
| -------------------------------- | -------------- | ------ | ------ |
| Ordinary bank interest debit     | BANK_OPERATING | DEBIT  | 120.00 |
| HELOC interest charge settlement | HELOC          | CREDIT | 120.00 |

Interest reconciliation checks charge presence, ordinary debit, HELOC
identification, amount/period match, settled-and-not-reversed, and ledger balance.

Stable ids: `interest:{interestCycleId}:{leg}`.

---

## Compensating an error

If a package was posted with the wrong amount, **do not edit the posted rows**.
Post compensating legs built with `buildCompensatingLedgerLeg` (opposite
direction, new `businessEventId`, `reversesBusinessEventId` = original), then
post the correct package under new ids.

---

## Integrity command and daily reports

```bash
pnpm --filter @csm/api verify:ledger -- --tenant <tenantId>
# or --all-tenants

pnpm --filter @csm/api report:daily-recon -- --tenant <tenantId> --date 2026-07-15
```

- **verify-ledger** — tenant-wide debit/credit equality; completed cycles have
  passed recon; provider refs are not cross-linked across cycles.
- **report:daily-recon** — upserts `DailyReconciliationReport` with conversion /
  interest pass-fail counts and ledger totals for the calendar day.

---

## Related

- [ADR-0006 Append-only ledger](./decisions/0006-append-only-ledger.md)
- [Monthly conversion workflow](./monthly-conversion-workflow.md)
- [HELOC interest workflow](./heloc-interest-workflow.md)
- [Data model invariants](./data-model-invariants.md)
