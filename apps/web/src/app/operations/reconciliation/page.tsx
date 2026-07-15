import { Money } from '@/components/ui/Money';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { apiFetch, ApiRequestError } from '@/lib/api-server';

type ReconPayload = {
  reconciliations: {
    id: string;
    kind: string;
    state: string;
    summary: string | null;
    cycleId: string | null;
    interestCycleId: string | null;
    items: {
      code: string;
      result: string;
      expectedValue: string | null;
      actualValue: string | null;
    }[];
    createdAt: string;
  }[];
  dailyReports: {
    id: string;
    reportDate: string;
    conversionPassedCount: number;
    conversionFailedCount: number;
    interestPassedCount: number;
    interestFailedCount: number;
    ledgerDebitCents: string | null;
    ledgerCreditCents: string | null;
    ledgerBalanced: boolean;
  }[];
};

export default async function OpsReconciliationPage() {
  try {
    const data = await apiFetch<ReconPayload>('/operations/reconciliation');
    return (
      <>
        <h1 className="brand">Operations · Reconciliation</h1>
        <p className="lede">Conversion/interest check results and daily ledger balance reports.</p>

        <h2 style={{ fontSize: '1.15rem' }}>Daily reports</h2>
        {data.dailyReports.length === 0 ? (
          <EmptyState title="No daily reports yet" />
        ) : (
          <div className="table-wrap panel">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Conversion pass/fail</th>
                  <th scope="col">Interest pass/fail</th>
                  <th scope="col">Ledger</th>
                </tr>
              </thead>
              <tbody>
                {data.dailyReports.map((r) => (
                  <tr key={r.id}>
                    <td>{r.reportDate}</td>
                    <td>
                      {r.conversionPassedCount}/{r.conversionFailedCount}
                    </td>
                    <td>
                      {r.interestPassedCount}/{r.interestFailedCount}
                    </td>
                    <td>
                      {r.ledgerBalanced ? 'Balanced' : 'Unbalanced'} · debit{' '}
                      <Money cents={r.ledgerDebitCents} /> / credit{' '}
                      <Money cents={r.ledgerCreditCents} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h2 style={{ fontSize: '1.15rem', marginTop: '1.5rem' }}>Cycle reconciliations</h2>
        {data.reconciliations.length === 0 ? (
          <EmptyState title="No reconciliations yet" />
        ) : (
          <div className="stack">
            {data.reconciliations.map((r) => (
              <article key={r.id} className="panel">
                <h3 style={{ marginTop: 0 }}>
                  {r.kind} · <code>{r.state}</code>
                </h3>
                <p style={{ marginTop: 0 }}>{r.summary ?? '—'}</p>
                <ul>
                  {r.items.map((item) => (
                    <li key={`${r.id}-${item.code}`}>
                      {item.code}: {item.result}
                      {item.expectedValue != null || item.actualValue != null
                        ? ` (expected ${item.expectedValue ?? '—'}, actual ${item.actualValue ?? '—'})`
                        : ''}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        )}
      </>
    );
  } catch (error) {
    return (
      <ErrorState
        title="Unable to load reconciliation"
        detail={error instanceof ApiRequestError ? error.message : 'Unexpected error'}
      />
    );
  }
}
