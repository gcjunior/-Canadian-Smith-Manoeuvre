'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type Scenario = {
  tenantId: string;
  slug: string;
  name: string;
  users: { userId: string; email: string; displayName: string }[];
};

export function LoginForm({
  scenarios,
  nextPath,
  preferredRole,
}: {
  scenarios: Scenario[];
  nextPath: string;
  preferredRole: 'CUSTOMER' | 'OPERATIONS';
}) {
  const router = useRouter();
  const [tenantId, setTenantId] = useState(scenarios[0]?.tenantId ?? '');
  const users = useMemo(
    () => scenarios.find((s) => s.tenantId === tenantId)?.users ?? [],
    [scenarios, tenantId],
  );
  const [userId, setUserId] = useState(users[0]?.userId ?? '');
  const [role, setRole] = useState<'CUSTOMER' | 'OPERATIONS'>(preferredRole);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const selectedUser = users.find((u) => u.userId === userId) ?? users[0];

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          userId: selectedUser?.userId,
          roles: [role],
          email: selectedUser?.email,
          displayName: selectedUser?.displayName,
        }),
      });
      const data = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        throw new Error(data.error?.message ?? 'Sign-in failed');
      }
      router.push(role === 'OPERATIONS' ? '/operations/cycles' : nextPath);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="panel stack" onSubmit={onSubmit} style={{ marginTop: '1.5rem' }}>
      <div className="field">
        <label htmlFor="tenant">Simulated household</label>
        <select
          id="tenant"
          name="tenant"
          value={tenantId}
          onChange={(e) => {
            setTenantId(e.target.value);
            const nextUsers = scenarios.find((s) => s.tenantId === e.target.value)?.users ?? [];
            setUserId(nextUsers[0]?.userId ?? '');
          }}
          required
        >
          {scenarios.map((s) => (
            <option key={s.tenantId} value={s.tenantId}>
              {s.name} ({s.slug})
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="user">User</label>
        <select
          id="user"
          name="user"
          value={selectedUser?.userId ?? ''}
          onChange={(e) => setUserId(e.target.value)}
          required
        >
          {users.map((u) => (
            <option key={u.userId} value={u.userId}>
              {u.displayName} — {u.email}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend>Role</legend>
        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.35rem' }}>
          <label>
            <input
              type="radio"
              name="role"
              value="CUSTOMER"
              checked={role === 'CUSTOMER'}
              onChange={() => setRole('CUSTOMER')}
            />{' '}
            Customer
          </label>
          <label>
            <input
              type="radio"
              name="role"
              value="OPERATIONS"
              checked={role === 'OPERATIONS'}
              onChange={() => setRole('OPERATIONS')}
            />{' '}
            Operations
          </label>
        </div>
      </fieldset>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="btn btn-primary" type="submit" disabled={pending || !selectedUser}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
