import { EmptyState, ErrorState } from '@/components/ui/States';
import { apiFetch, ApiRequestError } from '@/lib/api-server';

type ExceptionRow = {
  id: string;
  code: string;
  severity: string;
  state: string;
  message: string;
  strategyId: string | null;
  cycleId: string | null;
  correlationId: string | null;
  details: unknown;
  createdAt: string;
};

export default async function OpsExceptionsPage() {
  try {
    const rows = await apiFetch<ExceptionRow[]>('/operations/exceptions');
    return (
      <>
        <h1 className="brand">Operations · Exceptions</h1>
        <p className="lede">Open operational exceptions with error codes and correlation IDs.</p>
        {rows.length === 0 ? (
          <EmptyState title="No open exceptions" />
        ) : (
          <div className="table-wrap panel" style={{ marginTop: '1.25rem' }}>
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Severity</th>
                  <th scope="col">Code</th>
                  <th scope="col">Message</th>
                  <th scope="col">Correlation</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.severity}</td>
                    <td>
                      <code>{r.code}</code>
                    </td>
                    <td>
                      {r.message}
                      {r.details ? (
                        <pre style={{ fontSize: '0.8rem', marginTop: '0.35rem' }}>
                          {JSON.stringify(r.details, null, 2)}
                        </pre>
                      ) : null}
                    </td>
                    <td>
                      <code>{r.correlationId ?? '—'}</code>
                    </td>
                    <td>{new Date(r.createdAt).toLocaleString('en-CA')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  } catch (error) {
    return (
      <ErrorState
        title="Unable to load exceptions"
        detail={error instanceof ApiRequestError ? error.message : 'Unexpected error'}
      />
    );
  }
}
