'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const CUSTOMER_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/strategy', label: 'Strategy' },
  { href: '/activity', label: 'Activity' },
  { href: '/interest', label: 'Interest' },
  { href: '/documents', label: 'Documents' },
  { href: '/settings', label: 'Settings' },
  { href: '/onboarding', label: 'Onboarding' },
];

const OPS_LINKS = [
  { href: '/operations/cycles', label: 'Cycles' },
  { href: '/operations/exceptions', label: 'Exceptions' },
  { href: '/operations/webhooks', label: 'Webhooks' },
  { href: '/operations/reconciliation', label: 'Reconciliation' },
  { href: '/operations/workflows', label: 'Workflows' },
];

export function AppNav({ roles, displayName }: { roles: string[]; displayName?: string }) {
  const pathname = usePathname();
  const isOps = roles.includes('OPERATIONS') || roles.includes('ADMIN');
  const links = isOps ? OPS_LINKS : CUSTOMER_LINKS;

  return (
    <header className="nav">
      <div>
        <p
          style={{ margin: 0, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.75 }}
        >
          Canadian Smith Manoeuvre
        </p>
        <p style={{ margin: '0.25rem 0 0', color: 'var(--ink-muted)', fontSize: '0.9rem' }}>
          {displayName ?? 'Signed in'}
          {isOps ? ' · Operations' : ''}
        </p>
      </div>
      <nav aria-label="Primary">
        <ul className="nav-links">
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={
                  pathname === link.href || pathname.startsWith(`${link.href}/`)
                    ? 'page'
                    : undefined
                }
              >
                {link.label}
              </Link>
            </li>
          ))}
          <li>
            <form action="/api/auth/logout" method="post">
              <button type="submit" className="btn" style={{ padding: '0.25rem 0.6rem' }}>
                Sign out
              </button>
            </form>
          </li>
        </ul>
      </nav>
    </header>
  );
}
