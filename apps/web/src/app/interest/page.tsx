import { AppShell } from '@/components/AppShell';
import { Money } from '@/components/ui/Money';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { apiFetch, ApiRequestError } from '@/lib/api-server';
import { formatInTimezone } from '@/lib/timezone';

type Strategy = { id: string; timezone: string };
type InterestPayment = {
  id: string;
  amountCents: string | null;
  state: string;
  providerPaymentId: string;
  settledAt: string | null;
  createdAt: string;
};

export default async function InterestPage() {
  try {
    const strategies = await apiFetch<Strategy[]>('/strategies');
    const strategy = strategies[0];
    if (!strategy) {
      return (
        <AppShell>
          <EmptyState title="No interest history" />
        </AppShell>
      );
    }
    const payments = await apiFetch<InterestPayment[]>(
      `/strategies/${strategy.id}/interest-payments`,
    );
    return (
      <AppShell>
        <h1 className="brand">HELOC interest</h1>
        <p className="lede disclosure">
          Interest on borrowed HELOC funds is paid from your ordinary bank account — not from
          investment proceeds.
        </p>
        {payments.length === 0 ? (
          <EmptyState title="No interest payments yet" />
        ) : (
          <div className="table-wrap panel" style={{ marginTop: '1.25rem' }}>
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Amount (CAD)</th>
                  <th scope="col">State</th>
                  <th scope="col">Provider ref</th>
                  <th scope="col">Settled</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Money cents={p.amountCents} />
                    </td>
                    <td>{p.state}</td>
                    <td>
                      <code>{p.providerPaymentId}</code>
                    </td>
                    <td>{formatInTimezone(p.settledAt ?? p.createdAt, strategy.timezone)}</td>
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
          title="Unable to load interest payments"
          detail={error instanceof ApiRequestError ? error.message : 'Unexpected error'}
        />
      </AppShell>
    );
  }
}
