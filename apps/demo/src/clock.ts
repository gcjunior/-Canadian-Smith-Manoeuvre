import { DEMO, HOUR_MS } from './constants.js';
import { createBankAdmin, createBrokerageAdmin } from './sim-admin.js';

/**
 * Accelerated simulator clocks: advance simulated wall time instantly through
 * bank + brokerage admin run-events endpoints (no wall-clock waiting).
 */
export class AcceleratedSimulatorClock {
  private readonly bank;
  private readonly brokerage;

  constructor(bankBaseUrl: string, brokerageBaseUrl: string) {
    this.bank = createBankAdmin(bankBaseUrl);
    this.brokerage = createBrokerageAdmin(brokerageBaseUrl);
  }

  async advance(advanceMs: number): Promise<{ bankNow: string; brokerageNow: string }> {
    const [bank, brokerage] = await Promise.all([
      this.bank.runEvents(advanceMs),
      this.brokerage.runEvents(advanceMs),
    ]);
    return { bankNow: bank.now, brokerageNow: brokerage.now };
  }

  /** Advance through mortgage post only (12h). */
  async toMortgagePosted(): Promise<void> {
    await this.advance(DEMO.delays.mortgagePostingMs);
  }

  /** Advance through mortgage settlement after post (48h). */
  async toMortgageSettled(): Promise<void> {
    await this.advance(DEMO.delays.mortgageSettlementMs);
  }

  /** Advance through HELOC credit readvance after settlement (12h). */
  async toHelocReadvanced(): Promise<void> {
    await this.advance(DEMO.delays.helocReadvanceMs);
  }

  /**
   * Keep both clocks moving while Temporal Activities poll for draw / transfer /
   * deposit / fill settlement. One simulated hour per ticker interval.
   */
  startSettlementDriver(options?: { tickMs?: number; intervalWallMs?: number }): () => void {
    const tickMs = options?.tickMs ?? HOUR_MS;
    const intervalWallMs = options?.intervalWallMs ?? 25;
    const timer = setInterval(() => {
      void this.advance(tickMs).catch(() => {
        /* driver best-effort; errors surface via workflow/activity failures */
      });
    }, intervalWallMs);
    return () => clearInterval(timer);
  }
}
