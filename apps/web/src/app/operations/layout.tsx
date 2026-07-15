import type { ReactNode } from 'react';

import { AppShell } from '@/components/AppShell';

export default function OperationsLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
