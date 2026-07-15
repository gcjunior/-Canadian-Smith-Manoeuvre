import Link from 'next/link';

import { OpsResumeForm } from '@/components/operations/OpsResumeForm';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { Money } from '@/components/ui/Money';
import { apiFetch, ApiRequestError } from '@/lib/api-server';

type CycleRow = {
  id: string;
  strategyId: string;
  paymentPeriod: string;
  state: string;
  customerStatus: string;
  failureCode: string | null;
  correlationId: string;
};

type CycleDetail = {
  cycle: CycleRow & {
    principalRepaidCents: string | null;
    drawAmountCents: string | null;
  };
  exceptions: { id: string; code: string; message: string; severity: string }[];
  activityAttempts: Record<string, unknown>[];
  reconciliation: {
    state: string;
    summary: string | null;
    items: { code: string; result: string; detail: string | null }[];
  } | null;
  webhooks: { id: string; providerEventId: string; processingState: string; attempts: number }[];
  workflows: {
    temporalWorkflowId: string;
    temporalUiUrl: string;
    type: string;
  }[];
  safeActions: { canResumeStrategy: boolean };
};

export default async function OpsCyclesPage({
  searchParams,
}: {
  searchParams: Promise<{ cycleId?: string }>;
}) {
  const { cycleId } = await searchParams;
  try {
    const cycles = await apiFetch<CycleRow[]>('/operations/cycles');
    const detail = cycleId ? await apiFetch<CycleDetail>(`/operations/cycles/${cycleId}`) : null;

    return (
      <>
        <h1 className="brand">Operations · Cycles</h1>
        <p className="lede">
          Internal cycle state, provider activity, reconciliation, and Temporal links.
        </p>
        {cycles.length === 0 ? (
          <EmptyState title="No cycles for this tenant" />
        ) : (
          <div className="table-wrap panel" style={{ marginTop: '1.25rem' }}>
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Period</th>
                  <th scope="col">Internal state</th>
                  <th scope="col">Customer status</th>
                  <th scope="col">Failure</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {cycles.map((c) => (
                  <tr key={c.id}>
                    <td>{c.paymentPeriod}</td>
                    <td>
                      <code>{c.state}</code>
                    </td>
                    <td>
                      <StatusBadge status={c.customerStatus} />
                    </td>
                    <td>{c.failureCode ?? '—'}</td>
                    <td>
                      <Link href={`/operations/cycles?cycleId=${c.id}`}>Open</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {detail ? (
          <section className="panel stack" style={{ marginTop: '1.5rem' }}>
            <h2 style={{ margin: 0 }}>
              Cycle {detail.cycle.paymentPeriod} · <code>{detail.cycle.state}</code>
            </h2>
            <p style={{ margin: 0 }}>
              Correlation <code>{detail.cycle.correlationId}</code> · Principal{' '}
              <Money cents={detail.cycle.principalRepaidCents} /> · Borrowed{' '}
              <Money cents={detail.cycle.drawAmountCents} />
            </p>

            <h3 style={{ margin: 0 }}>Activity attempts</h3>
            {detail.activityAttempts.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--ink-muted)' }}>
                No money movements or orders yet.
              </p>
            ) : (
              <pre style={{ overflow: 'auto', fontSize: '0.85rem' }}>
                {JSON.stringify(detail.activityAttempts, null, 2)}
              </pre>
            )}

            <h3 style={{ margin: 0 }}>Reconciliation</h3>
            {detail.reconciliation ? (
              <div>
                <p style={{ margin: 0 }}>
                  {detail.reconciliation.state}: {detail.reconciliation.summary ?? '—'}
                </p>
                <ul>
                  {detail.reconciliation.items.map((item) => (
                    <li key={item.code}>
                      {item.code}: {item.result} {item.detail ?? ''}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p style={{ margin: 0, color: 'var(--ink-muted)' }}>No reconciliation record.</p>
            )}

            <h3 style={{ margin: 0 }}>Webhook history</h3>
            <ul>
              {detail.webhooks.map((w) => (
                <li key={w.id}>
                  {w.providerEventId} · {w.processingState} · attempts {w.attempts}
                </li>
              ))}
            </ul>

            <h3 style={{ margin: 0 }}>Temporal workflows</h3>
            <ul>
              {detail.workflows.map((w) => (
                <li key={w.temporalWorkflowId}>
                  {w.type}:{' '}
                  <a href={w.temporalUiUrl} target="_blank" rel="noreferrer">
                    {w.temporalWorkflowId}
                  </a>
                </li>
              ))}
            </ul>

            {detail.safeActions.canResumeStrategy ? (
              <OpsResumeForm strategyId={detail.cycle.strategyId} />
            ) : null}
          </section>
        ) : null}
      </>
    );
  } catch (error) {
    return (
      <ErrorState
        title="Unable to load cycles"
        detail={error instanceof ApiRequestError ? error.message : 'Unexpected error'}
      />
    );
  }
}
