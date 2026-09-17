import { z } from 'zod';

export const amountSchema = z
  .string()
  .regex(
    /^\d+(?:\.\d{1,2})?$/,
    'amount must use decimal major units with at most two decimals',
  )
  .refine((value) => Number(value) > 0, 'amount must be greater than zero');

export const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'currency must be an uppercase ISO 4217 code');

export const paymentContextSchema = z
  .object({
    transaction_type: z.enum(['spend', 'refund']),
    amount: amountSchema,
    currency: currencySchema,
    method: z.literal('CARD'),
    payment_connection_id: z.string().uuid(),
  })
  .strict();

export const stripeChallengeSchema = z
  .object({
    id: z.string().min(1),
    method: z.literal('stripe'),
    intent: z.literal('charge'),
    amount: amountSchema,
    currency: currencySchema,
    networkId: z.string().min(1),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type StripeChallenge = z.infer<typeof stripeChallengeSchema>;

export const paymentCredentialSchema = z
  .object({
    challengeId: z.string().min(1),
    spt: z.string().min(1),
  })
  .strict();

export function isExpired(expiresAt: string, now = new Date()): boolean {
  return new Date(expiresAt).getTime() <= now.getTime();
}

export function normalizeAmount(value: string): string {
  const [whole, fraction = ''] = value.split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}

export function multiplyAmount(value: string, quantity: number): string {
  const [whole, fraction] = normalizeAmount(value).split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction);
  const total = minor * BigInt(quantity);
  return `${total / 100n}.${(total % 100n).toString().padStart(2, '0')}`;
}

export function failed(message: string, code: string) {
  return {
    content: [{ type: 'text' as const, text: message }],
    structuredContent: { ok: false as const, code, message },
    isError: true as const,
  };
}
