'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Lightweight polling via router refresh — no separate message broker. */
export function PollRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => {
      router.refresh();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, router]);
  return null;
}
