import { z } from 'zod';

export const uuidSchema = z.string().uuid();

export const isoDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .describe('ISO-8601 timestamp with timezone offset; stored/interpreted as UTC');

export const paymentPeriodSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'paymentPeriod must be YYYY-MM');

export const correlationIdSchema = uuidSchema.describe('Correlation ID for request tracing');

export const canadianTimezoneSchema = z.enum([
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
]);

/** Decimal string for security quantity/price — never IEEE float. */
export const decimalStringSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,10})?$/, 'Invalid decimal string');

export type Uuid = z.infer<typeof uuidSchema>;
export type IsoDateTime = z.infer<typeof isoDateTimeSchema>;
export type PaymentPeriod = z.infer<typeof paymentPeriodSchema>;
export type CanadianTimezone = z.infer<typeof canadianTimezoneSchema>;
export type DecimalString = z.infer<typeof decimalStringSchema>;
