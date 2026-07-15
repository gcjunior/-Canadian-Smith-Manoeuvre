import Link from 'next/link';

import { AppShell } from '@/components/AppShell';
import { DashboardView, type DashboardData } from '@/components/dashboard/DashboardView';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { apiFetch, ApiRequestError } from '@/lib/api-server';

type Strategy = { id: string; name: string; state: string };

export default async function DashboardPage() {
  try {
    const strategies = await apiFetch<Strategy[]>('/strategies');
    const strategy = strategies[0];
    if (!strategy) {
      return (
        <AppShell>
          <EmptyState
            title="No strategy yet"
            detail="Complete onboarding to connect accounts and activate automation."
          />
          <p style={{ marginTop: '1rem' }}>
            <Link className="btn btn-primary" href="/onboarding">
              Start onboarding
            </Link>
          </p>
        </AppShell>
      );
    }
    const data = await apiFetch<DashboardData>(`/strategies/${strategy.id}/dashboard`);
    return (
      <AppShell>
        <DashboardView data={data} />
      </AppShell>
    );
  } catch (error) {
    const detail = error instanceof ApiRequestError ? error.message : 'Unexpected error';
    return (
      <AppShell>
        <ErrorState title="Unable to load dashboard" detail={detail} />
      </AppShell>
    );
  }
}
