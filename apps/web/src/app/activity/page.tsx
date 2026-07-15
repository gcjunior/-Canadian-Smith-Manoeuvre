import { AppShell } from '@/components/AppShell';
import { PollRefresh } from '@/components/PollRefresh';
import { Money } from '@/components/ui/Money';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { apiFetch, ApiRequestError } from '@/lib/api-server';
import { mapInternalCycleState } from '@/lib/customer-status';
import { formatInTimezone } from '@/lib/timezone';

type Strategy = { id: string; timezone: string };
type Cycle = {
  id: string;
  paymentPeriod: string;
  state: string;
  principalRepaidCents: string | null;
  drawAmountCents: string | null;
  updatedAt: string;
};

export default async function ActivityPage() {
  try {
    const strategies = await apiFetch<Strategy[]>('/strategies');
    const strategy = strategies[0];
    if (!strategy) {
      return (
        <AppShell>
          <EmptyState title="No activity yet" />
        </AppShell>
      );
    }
    const cycles = await apiFetch<Cycle[]>(`/strategies/${strategy.id}/cycles`);
    return (
      <AppShell>
        <PollRefresh />
        <h1 className="brand">Activity</h1>
        <p className="lede">Monthly conversion history with customer-friendly status labels.</p>
        {cycles.length === 0 ? (
          <EmptyState title="No conversion cycles yet" detail="Cycles appear after activation." />
        ) : (
          <div className="table-wrap panel" style={{ marginTop: '1.25rem' }}>
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Period</th>
                  <th scope="col">Status</th>
                  <th scope="col">Principal</th>
                  <th scope="col">Borrowed</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {cycles.map((cycle) => (
                  <tr key={cycle.id}>
                    <td>{cycle.paymentPeriod}</td>
                    <td>
                      <StatusBadge status={mapInternalCycleState(cycle.state)} />
                    </td>
                    <td>
                      <Money cents={cycle.principalRepaidCents} />
                    </td>
                    <td>
                      <Money cents={cycle.drawAmountCents} />
                    </td>
                    <td>{formatInTimezone(cycle.updatedAt, strategy.timezone)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AppShell>
    );
  } catch (error) {
    return (
      <AppShell>
        <ErrorState
          title="Unable to load activity"
          detail={error instanceof ApiRequestError ? error.message : 'Unexpected error'}
        />
      </AppShell>
    );
  }
}
