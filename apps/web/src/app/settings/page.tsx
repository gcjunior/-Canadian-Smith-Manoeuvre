import { AppShell } from '@/components/AppShell';
import { getSession } from '@/lib/session';

export default async function SettingsPage() {
  const session = await getSession();
  return (
    <AppShell>
      <h1 className="brand">Settings</h1>
      <p className="lede">Session identity is derived server-side from your signed cookie.</p>
      <dl className="panel stack" style={{ marginTop: '1.25rem' }}>
        <div>
          <dt>Display name</dt>
          <dd>{session?.displayName ?? '—'}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{session?.email ?? '—'}</dd>
        </div>
        <div>
          <dt>Roles</dt>
          <dd>{session?.roles.join(', ')}</dd>
        </div>
        <div>
          <dt>Tenant</dt>
          <dd>
            <code>{session?.tenantId}</code>
          </dd>
        </div>
      </dl>
      <p className="disclosure panel" style={{ marginTop: '1.25rem' }}>
        Access tokens are never exposed to client JavaScript. Sign out clears the HTTP-only session
        cookie.
      </p>
      <form action="/api/auth/logout" method="post" style={{ marginTop: '1rem' }}>
        <button type="submit" className="btn">
          Sign out
        </button>
      </form>
    </AppShell>
  );
}
