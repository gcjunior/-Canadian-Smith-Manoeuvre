import { EmptyState, ErrorState } from '@/components/ui/States';
import { apiFetch, ApiRequestError } from '@/lib/api-server';

type WorkflowRow = {
  id: string;
  strategyId: string;
  cycleId: string | null;
  type: string;
  temporalWorkflowId: string;
  temporalRunId: string | null;
  temporalNamespace: string;
  temporalUiUrl: string;
  createdAt: string;
};

export default async function OpsWorkflowsPage() {
  try {
    const rows = await apiFetch<WorkflowRow[]>('/operations/workflows');
    return (
      <>
        <h1 className="brand">Operations · Workflows</h1>
        <p className="lede">
          Stored workflow references with deep links into the Temporal UI (internal only).
        </p>
        {rows.length === 0 ? (
          <EmptyState title="No workflow references" />
        ) : (
          <div className="table-wrap panel" style={{ marginTop: '1.25rem' }}>
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">Workflow ID</th>
                  <th scope="col">Run</th>
                  <th scope="col">Namespace</th>
                  <th scope="col">Temporal UI</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.id}>
                    <td>{w.type}</td>
                    <td>
                      <code>{w.temporalWorkflowId}</code>
                    </td>
                    <td>
                      <code>{w.temporalRunId ?? '—'}</code>
                    </td>
                    <td>{w.temporalNamespace}</td>
                    <td>
                      <a href={w.temporalUiUrl} target="_blank" rel="noreferrer">
                        Open
                      </a>
                    </td>
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
        title="Unable to load workflows"
        detail={error instanceof ApiRequestError ? error.message : 'Unexpected error'}
      />
    );
  }
}
