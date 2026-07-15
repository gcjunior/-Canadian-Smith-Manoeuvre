'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function OpsResumeForm({ strategyId }: { strategyId: string }) {
  const router = useRouter();
  const [note, setNote] = useState('Cleared after ops review');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/backend/operations/strategies/${strategyId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearanceNote: note }),
      });
      const data = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) throw new Error(data.error?.message ?? 'Resume failed');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resume failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      <h3 style={{ margin: 0 }}>Safe resume</h3>
      <div className="field">
        <label htmlFor="clearance">Clearance note</label>
        <textarea
          id="clearance"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          required
          rows={2}
        />
      </div>
      {error ? (
        <p role="alert" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : null}
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? 'Resuming…' : 'Resume strategy'}
      </button>
    </form>
  );
}
