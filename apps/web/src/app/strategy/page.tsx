import { AppShell } from '@/components/AppShell';
import { Money } from '@/components/ui/Money';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { StrategyActions } from '@/components/StrategyActions';
import { apiFetch, ApiRequestError } from '@/lib/api-server';
import { automationLabel } from '@/lib/customer-status';

type Strategy = {
  id: string;
  name: string;
  state: string;
  timezone: string;
  expectedPaymentDay: number;
  pauseReason: string | null;
  investmentPolicy: { symbol: string; exchange: string; userMonthlyCapCents: string };
};

export default async function StrategyPage() {
  try {
    const strategies = await apiFetch<Strategy[]>('/strategies');
    const strategy = strategies[0];
    if (!strategy) {
      return (
        <AppShell>
          <EmptyState title="No strategy configured" detail="Use onboarding to create one." />
        </AppShell>
      );
    }
    return (
      <AppShell>
        <h1 className="brand">{strategy.name}</h1>
        <p className="lede">{automationLabel(strategy.state)}</p>
        <dl className="grid-metrics" style={{ marginTop: '1.25rem' }}>
          <div className="metric panel">
            <dt>ETF</dt>
            <dd>
              {strategy.investmentPolicy.symbol} ({strategy.investmentPolicy.exchange})
            </dd>
          </div>
          <div className="metric panel">
            <dt>Monthly cap</dt>
            <dd>
              <Money cents={strategy.investmentPolicy.userMonthlyCapCents} />
            </dd>
          </div>
          <div className="metric panel">
            <dt>Timezone</dt>
            <dd>{strategy.timezone}</dd>
          </div>
          <div className="metric panel">
            <dt>Expected payment day</dt>
            <dd>{strategy.expectedPaymentDay}</dd>
          </div>
        </dl>
        {strategy.pauseReason ? (
          <p className="panel" style={{ marginTop: '1rem' }}>
            Pause reason: {strategy.pauseReason}
          </p>
        ) : null}
        <div style={{ marginTop: '1.25rem' }}>
          <StrategyActions strategyId={strategy.id} state={strategy.state} />
        </div>
        <p className="disclosure panel" style={{ marginTop: '1.5rem' }}>
          Pausing stops future HELOC draws and investments. The outstanding investment-loan balance
          remains borrowed money until repaid outside this simulator.
        </p>
      </AppShell>
    );
  } catch (error) {
    return (
      <AppShell>
        <ErrorState
          title="Unable to load strategy"
          detail={error instanceof ApiRequestError ? error.message : 'Unexpected error'}
        />
      </AppShell>
    );
  }
}
