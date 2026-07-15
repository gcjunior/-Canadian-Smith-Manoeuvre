'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function StrategyActions({ strategyId, state }: { strategyId: string; state: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(path: string, body: Record<string, unknown>) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/backend/strategies/${strategyId}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) throw new Error(data.error?.message ?? 'Action failed');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="stack">
      {error ? (
        <p role="alert" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : null}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        {state === 'ACTIVE' ? (
          <button
            type="button"
            className="btn"
            disabled={pending}
            onClick={() => void act('pause', { reason: 'Customer paused from settings UI' })}
          >
            Pause automation
          </button>
        ) : null}
        {state === 'PAUSED' ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending}
            onClick={() => void act('resume', { clearanceNote: 'Customer resumed from UI' })}
          >
            Resume automation
          </button>
        ) : null}
      </div>
    </div>
  );
}
