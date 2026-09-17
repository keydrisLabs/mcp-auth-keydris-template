import { z } from 'zod';

export const STRIPE_API_BASE = 'https://api.stripe.com';
export const STRIPE_API_VERSION = '2026-07-29.preview';

const zeroDecimalCurrencies = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);
const threeDecimalCurrencies = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);

export function toMinorUnits(amount: string, currency: string): number {
  const exponent = zeroDecimalCurrencies.has(currency)
    ? 0
    : threeDecimalCurrencies.has(currency)
      ? 3
      : 2;
  const [whole, fraction = ''] = amount.split('.');
  if (exponent === 0 && /[1-9]/.test(fraction)) {
    throw new Error(`${currency} does not support fractional amounts`);
  }
  const padded = fraction.padEnd(exponent, '0');
  if (padded.length > exponent && /[1-9]/.test(padded.slice(exponent))) {
    throw new Error(`${amount} has too much precision for ${currency}`);
  }
  const minor =
    BigInt(whole) * 10n ** BigInt(exponent) +
    BigInt(padded.slice(0, exponent) || '0');
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('amount exceeds the safe Stripe integer range');
  }
  return Number(minor);
}

export function stripeRequest(
  values: Record<string, string | number | boolean>,
  requestId: string,
): RequestInit {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    body.set(key, String(value));
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'idempotency-key': requestId,
      'stripe-version': STRIPE_API_VERSION,
    },
    body,
  };
}

const stripeErrorSchema = z.object({
  error: z.object({
    message: z.string().optional(),
    code: z.string().optional(),
  }),
});

export async function stripePayload(response: Response): Promise<unknown> {
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsed = stripeErrorSchema.safeParse(payload);
    throw new Error(
      parsed.success
        ? (parsed.data.error.message ??
            parsed.data.error.code ??
            `Stripe HTTP ${response.status}`)
        : `Stripe HTTP ${response.status}`,
    );
  }
  return payload;
}
