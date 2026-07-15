import { WebhookRetryButton } from '@/components/operations/WebhookRetryButton';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { apiFetch, ApiRequestError } from '@/lib/api-server';

type WebhookRow = {
  id: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  processingState: string;
  attempts: number;
  lastError: string | null;
  outcome: string | null;
  receivedAt: string;
};

export default async function OpsWebhooksPage() {
  try {
    const rows = await apiFetch<WebhookRow[]>('/operations/webhooks');
    return (
      <>
        <h1 className="brand">Operations · Webhooks</h1>
        <p className="lede">
          Provider webhook history, attempt counts, and safe retry for eligible rows.
        </p>
        {rows.length === 0 ? (
          <EmptyState title="No webhooks recorded" />
        ) : (
          <div className="table-wrap panel" style={{ marginTop: '1.25rem' }}>
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Provider</th>
                  <th scope="col">Event</th>
                  <th scope="col">State</th>
                  <th scope="col">Attempts</th>
                  <th scope="col">Error</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.id}>
                    <td>{w.provider}</td>
                    <td>
                      <div>{w.eventType}</div>
                      <code style={{ fontSize: '0.8rem' }}>{w.providerEventId}</code>
                    </td>
                    <td>
                      <code>{w.processingState}</code>
                    </td>
                    <td>{w.attempts}</td>
                    <td>{w.lastError ?? w.outcome ?? '—'}</td>
                    <td>
                      {['DEAD_LETTERED', 'RETAINED', 'RETRYABLE'].includes(w.processingState) ? (
                        <WebhookRetryButton webhookId={w.id} />
                      ) : (
                        '—'
                      )}
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
        title="Unable to load webhooks"
        detail={error instanceof ApiRequestError ? error.message : 'Unexpected error'}
      />
    );
  }
}
