import { z } from 'zod';

/**
 * CAD integer cents.
 * Accepts bigint, integer number, or digit string; always outputs bigint.
 * Rejects floats and non-integer numeric strings.
 */
export const cadCentsSchema = z
  .union([
    z.bigint(),
    z.number().int({ message: 'Money must be an integer number of cents' }).finite(),
    z
      .string()
      .regex(/^-?\d+$/, 'Money string must be an integer number of cents')
      .transform((value) => BigInt(value)),
  ])
  .transform((value) => (typeof value === 'bigint' ? value : BigInt(value)));

export const nonNegativeCadCentsSchema = cadCentsSchema.refine((value) => value >= 0n, {
  message: 'Amount must be non-negative cents',
});

export const positiveCadCentsSchema = cadCentsSchema.refine((value) => value > 0n, {
  message: 'Amount must be positive cents',
});

export type CadCents = z.infer<typeof cadCentsSchema>;

/** JSON-wire serialization for OpenAPI / HTTP bodies (stringified integer cents). */
export function serializeCadCents(cents: bigint): string {
  return cents.toString();
}

export function parseCadCents(input: unknown): CadCents {
  return cadCentsSchema.parse(input);
}
