const CANADIAN_TIMEZONES = [
  'America/St_Johns',
  'America/Halifax',
  'America/Toronto',
  'America/Winnipeg',
  'America/Edmonton',
  'America/Vancouver',
] as const;

export type CanadianTimezone = (typeof CANADIAN_TIMEZONES)[number];

export function listCanadianTimezones(): readonly CanadianTimezone[] {
  return CANADIAN_TIMEZONES;
}

export function formatInTimezone(
  iso: string | null | undefined,
  timezone: string,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: 'medium',
    timeStyle: 'short',
  },
): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, ...options }).format(date);
}
