import { StatusBadge } from '@/components/ui/StatusBadge';
import { Money } from '@/components/ui/Money';
import { PollRefresh } from '@/components/PollRefresh';
import { formatInTimezone } from '@/lib/timezone';
import { automationLabel } from '@/lib/customer-status';

export type DashboardData = {
  strategy: {
    id: string;
    name: string;
    state: string;
    timezone: string;
    investmentPolicy: { symbol: string; userMonthlyCapCents: string };
  };
  automationActive: boolean;
  automationLabel: string;
  nextExpectedCheckAt: string | null;
  timezone: string;
  latestMortgagePaymentCents: string | null;
  principalRepaidCents: string | null;
  latestBorrowedCents: string | null;
  latestInvestedCents: string | null;
  investmentLoanBalanceCents: string | null;
  helocInterestPaidFromOrdinaryCents: string | null;
  latestCycle: {
    id: string;
    paymentPeriod: string;
    customerStatus: string;
    updatedAt: string;
  } | null;
  exceptionsRequiringAttention: {
    id: string;
    code: string;
    message: string;
    severity: string;
  }[];
};

export function DashboardView({ data }: { data: DashboardData }) {
  return (
    <div className="stack">
      <PollRefresh intervalMs={5000} />
      <div
        className="panel"
        style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}
      >
        <div>
          <h1 className="brand" style={{ fontSize: '2rem' }}>
            {data.strategy.name}
          </h1>
          <p className="lede" style={{ margin: '0.35rem 0 0' }}>
            {automationLabel(data.strategy.state)} · {data.strategy.investmentPolicy.symbol}
          </p>
        </div>
        <span className={`badge ${data.automationActive ? 'badge-ok' : 'badge-warn'}`}>
          {data.automationActive ? 'Automation active' : 'Automation paused'}
        </span>
      </div>

      <p className="disclosure panel" style={{ margin: 0 }}>
        This automation borrows from your HELOC and invests — creating investment debt. Interest is
        paid from your ordinary account.
      </p>

      <dl className="grid-metrics">
        <div className="metric panel">
          <dt>Automation</dt>
          <dd>{data.automationActive ? 'Active' : 'Paused'}</dd>
        </div>
        <div className="metric panel">
          <dt>Next expected check</dt>
          <dd>{formatInTimezone(data.nextExpectedCheckAt, data.timezone)}</dd>
        </div>
        <div className="metric panel">
          <dt>Latest mortgage payment</dt>
          <dd>
            <Money cents={data.latestMortgagePaymentCents} />
          </dd>
        </div>
        <div className="metric panel">
          <dt>Principal repaid</dt>
          <dd>
            <Money cents={data.principalRepaidCents} />
          </dd>
        </div>
        <div className="metric panel">
          <dt>Latest amount borrowed</dt>
          <dd>
            <Money cents={data.latestBorrowedCents} />
          </dd>
        </div>
        <div className="metric panel">
          <dt>Latest amount invested</dt>
          <dd>
            <Money cents={data.latestInvestedCents} />
          </dd>
        </div>
        <div className="metric panel">
          <dt>Investment-loan balance</dt>
          <dd>
            <Money cents={data.investmentLoanBalanceCents} />
          </dd>
        </div>
        <div className="metric panel">
          <dt>HELOC interest paid (ordinary)</dt>
          <dd>
            <Money cents={data.helocInterestPaidFromOrdinaryCents} />
          </dd>
        </div>
        <div className="metric panel">
          <dt>Latest cycle status</dt>
          <dd>
            {data.latestCycle ? <StatusBadge status={data.latestCycle.customerStatus} /> : '—'}
          </dd>
        </div>
      </dl>

      <section className="panel stack">
        <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Exceptions requiring attention</h2>
        {data.exceptionsRequiringAttention.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--ink-muted)' }}>No open exceptions.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
            {data.exceptionsRequiringAttention.map((ex) => (
              <li key={ex.id}>
                <strong>{ex.code}</strong> — {ex.message}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
