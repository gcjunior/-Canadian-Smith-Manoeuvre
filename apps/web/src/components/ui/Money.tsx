import { formatCadCents } from '@/lib/money';

export function Money({ cents }: { cents: string | number | null | undefined }) {
  return <span>{formatCadCents(cents)}</span>;
}
