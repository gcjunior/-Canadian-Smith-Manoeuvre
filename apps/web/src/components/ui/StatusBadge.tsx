import type { CustomerCycleStatus } from '@/lib/customer-status';

const WARN: CustomerCycleStatus[] = [
  'Waiting for mortgage payment',
  'Waiting for available credit',
  'Transferring funds',
  'Investing',
  'Confirming transactions',
];

export function StatusBadge({ status }: { status: CustomerCycleStatus | string }) {
  const tone =
    status === 'Completed'
      ? 'badge-ok'
      : status === 'Paused'
        ? 'badge-danger'
        : WARN.includes(status as CustomerCycleStatus)
          ? 'badge-warn'
          : '';
  return <span className={`badge ${tone}`}>{status}</span>;
}
