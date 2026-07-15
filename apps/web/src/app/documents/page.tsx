import { AppShell } from '@/components/AppShell';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { apiFetch, ApiRequestError } from '@/lib/api-server';

type Doc = {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  createdAt: string;
};

export default async function DocumentsPage() {
  try {
    const docs = await apiFetch<Doc[]>('/documents');
    return (
      <AppShell>
        <h1 className="brand">Documents</h1>
        <p className="lede">
          Audit trail of strategy actions for your household (redacted payloads).
        </p>
        {docs.length === 0 ? (
          <EmptyState title="No documents yet" />
        ) : (
          <div className="table-wrap panel" style={{ marginTop: '1.25rem' }}>
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Action</th>
                  <th scope="col">Resource</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td>{new Date(d.createdAt).toLocaleString('en-CA')}</td>
                    <td>{d.action}</td>
                    <td>
                      {d.resourceType}
                      {d.resourceId ? ` · ${d.resourceId.slice(0, 8)}…` : ''}
                    </td>
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
          title="Unable to load documents"
          detail={error instanceof ApiRequestError ? error.message : 'Unexpected error'}
        />
      </AppShell>
    );
  }
}
