# Product Requirements — Canadian Smith Manoeuvre Simulator

## 1. Purpose

Build a **multi-tenant automation simulator** of the Canadian Smith Manoeuvre (debt-to-investment conversion using a readvanceable mortgage / HELOC structure). The product demonstrates and tests the operational control loop—scheduling, settlement waits, HELOC draws, brokerage funding, ETF purchase, reconciliation, pause-on-failure—without moving real money or giving advice.

## 2. Problem statement

Manual Smith Manoeuvre execution is error-prone: principal amounts vary, HELOC credit updates lag, interest must be paid from the ordinary bank account (never from investment proceeds), and partial failures leave money trails hard to audit. Operators need a safe sandbox that:

- Models accounts, timing, and failure modes realistically enough for automation design.
- Produces an immutable money trail and audit record per conversion cycle.
- Enforces safety pauses when reconciliation or risk rules fail.
- Isolates tenant data strictly.

## 3. Goals (MVP)

1. Simulate mortgage payment → HELOC credit unlock → capped draw → brokerage transfer → fractional ETF purchase → full reconciliation.
2. Separately simulate and reconcile HELOC interest charged on the HELOC and paid from the ordinary bank account.
3. Run cycles via Temporal Schedules with durable polling and optional bank webhooks.
4. Support deterministic scenarios for automated tests and optional seeded failures for demos.
5. Provide tenant-scoped APIs and an audit-visible run history UI.
6. Disclose leverage, debt, interest, and investment risk in customer-facing copy.

## 4. Non-goals (explicit)

| Non-goal                    | Rationale                                                                  |
| --------------------------- | -------------------------------------------------------------------------- |
| Real bank integration       | Out of scope; simulators only for MVP                                      |
| Real brokerage integration  | Same                                                                       |
| Investment advice           | Product is operational automation, not advice                              |
| Tax determination           | Interest deductibility and tax outcomes are user/advisor concerns          |
| Portfolio rebalancing       | Single user-selected simulated ETF only                                    |
| Dividend recycling          | Not modeled in MVP                                                         |
| Capitalizing HELOC interest | Interest is paid from ordinary bank cash, never capitalized via HELOC draw |
| Real-money execution        | No production payment rails                                                |

## 5. Personas

- **Tenant admin** — configures firm/household tenant; manages users.
- **Strategy owner (end user)** — links simulated accounts, sets monthly draw cap and ETF, views cycle history, acknowledges risk disclosures.
- **Platform operator** — sets platform monthly draw cap, monitors failed cycles, inspects redacted provider payloads.
- **Engineer / QA** — authors deterministic simulator scenarios and regression tests.

## 6. Core user journeys

### 6.1 Onboard a strategy

1. Authenticate (identity yields `tenantId` + `userId`).
2. Acknowledge risk disclosures (leverage, HELOC debt growth, interest cost, investment loss).
3. Attach or create simulated: mortgage, HELOC, ordinary bank, non-registered brokerage.
4. Select simulated ETF symbol, user monthly draw cap (CAD cents), IANA timezone, expected mortgage payment day.
5. Activate strategy → Temporal Schedule registered for that strategy.

### 6.2 Monthly conversion (automated)

Described in detail in [monthly-conversion-workflow.md](./monthly-conversion-workflow.md). High level: Schedule starts a cycle after the expected payment date → poll/wait for SETTLED mortgage payment → wait for HELOC credit → draw capped amount → transfer → buy ETF → reconcile → complete or pause.

### 6.3 HELOC interest (automated, separate)

Described in [heloc-interest-workflow.md](./heloc-interest-workflow.md). Interest accrues on HELOC; payment is debited from ordinary bank account; investment funds must never pay interest.

### 6.4 Inspect / pause / resume

- View cycle status, money trail, pause reason.
- Manual pause always allowed.
- Resume only after operator/user clears the safety condition (recorded in audit).

## 7. Functional requirements

| ID    | Requirement                                                                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------------- |
| FR-1  | System shall start at most one active conversion cycle per strategy per mortgage payment period                                 |
| FR-2  | Conversion shall proceed only after mortgage payment status is `SETTLED`                                                        |
| FR-3  | Draw amount shall be `min(principalRepaid, newlyAvailableHelocCredit, userMonthlyCap, platformMonthlyCap)` in integer CAD cents |
| FR-4  | HELOC draw must be confirmed before transfer                                                                                    |
| FR-5  | Brokerage deposit must be confirmed before order submission                                                                     |
| FR-6  | Order fill and settlement must be confirmed before cycle completion                                                             |
| FR-7  | Full money-trail reconciliation is required before marking cycle `COMPLETED`                                                    |
| FR-8  | Any safety or reconciliation failure shall pause the strategy and emit an immutable audit record                                |
| FR-9  | HELOC interest debit shall be monitored and reconciled by a separate workflow                                                   |
| FR-10 | Investment / HELOC borrow proceeds shall never be eligible sources for interest payment                                         |
| FR-11 | All financial POST operations require idempotency keys; timed-out POSTs must be reconciled before retry                         |
| FR-12 | Every user-owned record shall include `tenantId`; tenant context derives from auth, never body alone                            |
| FR-13 | Simulators shall support deterministic scenario packs                                                                           |
| FR-14 | Customer UI/API copy shall not hide leverage, debt, interest, or investment risk                                                |

## 8. Non-functional requirements

| ID    | Requirement                                                                              |
| ----- | ---------------------------------------------------------------------------------------- |
| NFR-1 | Temporal workflows remain deterministic (no DB/network/random/FS in workflow code)       |
| NFR-2 | Money stored and computed as integer cents; security quantities as Decimal/string        |
| NFR-3 | UTC storage; schedules use explicit IANA timezones                                       |
| NFR-4 | Structured JSON logs with correlation IDs; redact secrets and full account numbers       |
| NFR-5 | Append-only financial ledger and audit events                                            |
| NFR-6 | Local stack runnable via Docker Compose (Postgres, Temporal, Temporal UI, app processes) |

## 9. Success metrics (MVP)

- Deterministic end-to-end conversion test passes for happy path and primary failure paths.
- Zero cross-tenant data leakage in automated tenancy tests.
- 100% of completed cycles have a reconcilable ledger trail from mortgage principal → HELOC draw → transfer → ETF fill.
- Interest workflow never posts a debit sourced from brokerage or HELOC draw proceeds.

## 10. Risks disclosed to users (product copy requirements)

Customer-facing surfaces must state clearly that:

- The strategy uses **borrowed money (HELOC)** to invest; losses can exceed interest costs.
- HELOC balances and interest charges can **grow over time**.
- Investments can **decline in value**; there is no principal guarantee.
- This simulator **does not provide tax or investment advice**.
- Simulated results do not predict real-world broker or bank behaviour.

## 11. MVP acceptance criteria

See acceptance criteria section at the end of [system-architecture.md](./system-architecture.md).
