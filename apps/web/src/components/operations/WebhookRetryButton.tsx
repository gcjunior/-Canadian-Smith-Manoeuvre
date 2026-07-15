'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function WebhookRetryButton({ webhookId }: { webhookId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/backend/operations/webhooks/${webhookId}/retry`, {
        method: 'POST',
      });
      const data = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) throw new Error(data.error?.message ?? 'Retry failed');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <span>
      <button type="button" className="btn" disabled={pending} onClick={() => void onClick()}>
        {pending ? 'Retrying…' : 'Safe retry'}
      </button>
      {error ? (
        <span role="alert" style={{ color: 'var(--danger)', marginLeft: '0.5rem' }}>
          {error}
        </span>
      ) : null}
    </span>
  );
}
