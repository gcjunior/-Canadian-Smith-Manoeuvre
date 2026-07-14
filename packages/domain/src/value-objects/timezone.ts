import { DomainError } from '../errors.js';

/** Canadian IANA timezones accepted by Strategy. */
export const CANADIAN_IANA_TIMEZONES = [
  'America/St_Johns',
  'America/Halifax',
  'America/Glace_Bay',
  'America/Moncton',
  'America/Goose_Bay',
  'America/Blanc-Sablon',
  'America/Toronto',
  'America/Iqaluit',
  'America/Nipigon',
  'America/Thunder_Bay',
  'America/Pangnirtung',
  'America/Atikokan',
  'America/Winnipeg',
  'America/Rainy_River',
  'America/Resolute',
  'America/Rankin_Inlet',
  'America/Regina',
  'America/Swift_Current',
  'America/Edmonton',
  'America/Cambridge_Bay',
  'America/Yellowknife',
  'America/Inuvik',
  'America/Creston',
  'America/Dawson_Creek',
  'America/Fort_Nelson',
  'America/Vancouver',
  'America/Whitehorse',
  'America/Dawson',
] as const;

export type CanadianTimezone = (typeof CANADIAN_IANA_TIMEZONES)[number];

const SET = new Set<string>(CANADIAN_IANA_TIMEZONES);

export function asCanadianTimezone(value: string): CanadianTimezone {
  if (!SET.has(value)) {
    throw new DomainError('INVALID_TIMEZONE', `Timezone must be a Canadian IANA zone: ${value}`);
  }
  return value as CanadianTimezone;
}
