# HELOC Interest Workflow

## Purpose

Confirm and reconcile **HELOC interest** as a process **separate** from monthly investment conversion.

Critical invariant:

> Investment funds and HELOC draw proceeds must **never** be used to pay HELOC interest. Interest is charged on the HELOC and paid by debit from the user’s **ordinary bank account** (`BANK_OPERATING`).

## Why separate from conversion

| Reason                    | Detail                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| Different trigger cadence | Interest may post on a bank schedule distinct from mortgage payment day                       |
| Different money trail     | Interest: HELOC interest charge + operating-account debit; Conversion: draw → brokerage → ETF |
| Failure isolation         | Interest NSF must not corrupt conversion ledger logic (though it may still pause strategy)    |
| Compliance clarity        | Makes the “no capitalization of interest via HELOC draw” rule auditable                       |

## Trigger model

- Temporal Schedule (e.g. expected interest posting window), and/or
- Bank webhook when an interest charge is posted → Signal to wake the workflow.

Workflow id (deterministic): `heloc-interest:{strategyId}:{interestPeriodId}`.

## Flow

```mermaid
flowchart TD
  S[Schedule or interest webhook] --> W[HelocInterestWorkflow]
  W --> C[Detect HELOC interest charge]
  C --> W1[Wait until charge is SETTLED / posted]
  W1 --> D[Observe ordinary bank debit for interest]
  D --> W2[Wait until debit SETTLED]
  W2 --> V[Validate debit source account is BANK_OPERATING]
  V --> R[Reconcile charge amount equals debit amount]
  R -->|pass| Done[Complete interest cycle + audit]
  R -->|fail| Pause[Pause strategy + audit]
  V -->|source is brokerage or HELOC draw| Pause
```

## Interest-payment workflow diagram

```mermaid
sequenceDiagram
  autonumber
  participant Sch as Temporal Schedule / Webhook
  participant WF as HelocInterestWorkflow
  participant Bank as Bank / HELOC Simulator
  participant Led as Ledger
  participant Dom as Interest Rules
  participant Aud as Audit

  Sch->>WF: start or Signal
  loop until charge visible/SETTLED
    WF->>Bank: getHelocInterestCharges(period)
    WF->>WF: sleep / Signal wake
  end
  Bank-->>WF: chargeAmount C on HELOC
  loop until debit SETTLED
    WF->>Bank: getOperatingAccountDebits(period)
  end
  Bank-->>WF: debitAmount C from BANK_OPERATING
  WF->>Dom: assertDebitSourceNotInvestment(accountKind)
  WF->>Dom: assertAmountsEqual(C)
  WF->>Led: append interest + debit legs
  alt OK
    WF->>Aud: INTEREST_CYCLE_COMPLETED
  else Violation or mismatch
    WF->>Aud: SAFETY_PAUSE INTEREST_RULE
    WF->>WF: pauseStrategy
  end
```

## Validation rules

1. HELOC shows interest charge amount `C` (cents) for the period.
2. Ordinary bank shows debit `C` (or documented fee split policy—**MVP: exact match**).
3. Debit account kind ∈ {`BANK_OPERATING`} only.
4. Reject if debit is sourced from `BROKERAGE_CASH`, `BROKERAGE_POSITION` liquidation, or a HELOC **draw** intended for investment.
5. Conversion workflow must not create ledger entries that pay interest.
6. Capitalizing interest (drawing HELOC to pay interest) is a **non-goal** and a **safety pause** if detected by monitors.

## Interaction with monthly conversion

- No shared workflow state machine.
- Shared **strategy pause** flag: either workflow may pause.
- Reconciliation monitors may run a cross-check Activity: “no interest paid from investment accounts this period.”

## Observability

- Distinct `workflowType`, `interestCycleId`, correlation id.
- Metrics: interest confirm latency, NSF count, rule-violation pauses.

## Related documents

- [monthly-conversion-workflow.md](./monthly-conversion-workflow.md)
- [failure-model.md](./failure-model.md)
- [domain-glossary.md](./domain-glossary.md)
