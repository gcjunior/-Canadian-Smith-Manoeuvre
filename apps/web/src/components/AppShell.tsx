import type { ReactNode } from 'react';

import { AppNav } from '@/components/AppNav';
import { getSession } from '@/lib/session';

export async function AppShell({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) {
    return <main className="shell">{children}</main>;
  }
  return (
    <main className="shell">
      <AppNav roles={session.roles} displayName={session.displayName ?? session.email} />
      {children}
    </main>
  );
}
