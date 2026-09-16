import { MCPServer } from 'mcp-use';
import { z } from 'zod';
import { createKitReader, keydrisCredentials } from '../../src/keydris/index.js';
import {
  amountSchema,
  failed,
  isExpired,
  multiplyAmount,
  normalizeAmount,
  paymentCredentialSchema,
  stripeChallengeSchema,
} from '../../src/payments.js';
import { issueChallenge, verifyChallenge } from './src/challenge.js';
import { config } from './src/config.js';

const server = new MCPServer({
  name: 'keydris-seller-mcp',
  title: 'Keydris Seller MCP',
  version: '0.1.0',
  description:
    'Seller merchant MCP for Stripe MPP quotes, payment challenges, governed charges, and refunds.',
});

const reader = config.gatewayUrl
  ? createKitReader({
      gatewayUrl: config.gatewayUrl,
      tokenHeader: config.tokenHeader,
    })
  : null;

// Keep the KIT reader at the transport boundary for every seller tool. Quote
// and challenge generation do not reveal a credential; charge, refund, and
// status will spend the action token when their governed Stripe call is wired.
server.use('mcp:tools/call', keydrisCredentials(reader));

const lineItemSchema = z.object({
  sku: z.string(),
  name: z.string(),
  quantity: z.number().int().positive(),
  amount: amountSchema,
  currency: z.string(),
});

function pricedItem(sku: string, quantity: number) {
  const product = config.catalog.get(sku);
  if (!product) return null;
  const amount = multiplyAmount(product.unitAmount, quantity);
  return { sku, name: product.name, quantity, amount, currency: product.currency };
}

export const quote = server.tool(
  {
    name: 'quote',
    description: 'Return a server-authoritative quote for a configured product.',
    inputSchema: z.object({
      sku: z.string().min(1),
      quantity: z.number().int().positive().max(100),
    }),
    outputSchema: z.union([
      lineItemSchema,
      z.object({ ok: z.literal(false), code: z.string(), message: z.string() }),
    ]),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ sku, quantity }) => {
    const item = pricedItem(sku, quantity);
    if (!item) return failed('The requested product does not exist.', 'product_not_found');
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(item) }],
      structuredContent: item,
    };
  },
);

export const purchase = server.tool(
  {
    name: 'purchase',
    description:
      'Create a Stripe MPP challenge for a product, or validate a submitted payment credential before a governed charge.',
    inputSchema: z.object({
      sku: z.string().min(1),
      quantity: z.number().int().positive().max(100),
      request_id: z.string().min(1),
      payment_credential: paymentCredentialSchema.optional(),
    }),
    outputSchema: z.union([
      z.object({ ok: z.literal(false), code: z.string(), message: z.string() }),
      z.object({ ok: z.literal(false), code: z.literal('payment_required'), challenge: stripeChallengeSchema }),
      z.object({ ok: z.literal(true), paymentIntentId: z.string(), status: z.string() }),
    ]),
    annotations: { readOnlyHint: false, openWorldHint: true },
  },
  async ({ sku, quantity, payment_credential: credential }) => {
    const item = pricedItem(sku, quantity);
    if (!item) return failed('The requested product does not exist.', 'product_not_found');
    if (!config.networkId) {
      return failed('STRIPE_NETWORK_ID is not configured.', 'seller_not_configured');
    }
    if (!config.signingSecret) {
      return failed(
        'SELLER_CHALLENGE_SIGNING_SECRET is not configured.',
        'seller_not_configured',
      );
    }

    if (!credential) {
      const challenge = issueChallenge(
        {
          method: 'stripe',
          intent: 'charge',
          amount: item.amount,
          currency: item.currency,
          networkId: config.networkId,
          expiresAt: new Date(
            Date.now() + config.challengeTtlSeconds * 1000,
          ).toISOString(),
          sku,
          quantity,
        },
        config.signingSecret,
      );
      return {
        content: [{ type: 'text' as const, text: 'Payment is required to complete this purchase.' }],
        structuredContent: {
          ok: false as const,
          code: 'payment_required' as const,
          challenge,
        },
        isError: true as const,
      };
    }

    try {
      const bound = verifyChallenge(credential.challengeId, config.signingSecret);
      if (
        bound.sku !== sku ||
        bound.quantity !== quantity ||
        normalizeAmount(bound.amount) !== item.amount ||
        bound.currency !== item.currency ||
        bound.networkId !== config.networkId
      ) {
        return failed(
          'The payment credential is not bound to this purchase.',
          'challenge_mismatch',
        );
      }
      if (isExpired(bound.expiresAt)) {
        return failed('The payment challenge has expired.', 'challenge_expired');
      }
    } catch {
      return failed('The payment challenge is invalid.', 'challenge_invalid');
    }

    return failed(
      'The credential was validated, but charging is unavailable until the seller payment release endpoint is enabled.',
      'payment_release_unavailable',
    );
  },
);

export const refund = server.tool(
  {
    name: 'refund',
    description:
      'Request a seller-policy-governed Stripe refund for a PaymentIntent.',
    inputSchema: z.object({
      payment_intent_id: z.string().min(1),
      amount: amountSchema,
      currency: z.string().regex(/^[A-Z]{3}$/),
      request_id: z.string().min(1),
    }),
    outputSchema: z.union([
      z.object({ ok: z.literal(false), code: z.string(), message: z.string() }),
      z.object({ ok: z.literal(true), refundId: z.string(), status: z.string() }),
    ]),
    annotations: { readOnlyHint: false, openWorldHint: true },
  },
  async () =>
    failed(
      'Refunding is unavailable until the seller payment release endpoint is enabled.',
      'payment_release_unavailable',
    ),
);

export const paymentStatus = server.tool(
  {
    name: 'payment_status',
    description:
      'Return the governed Stripe status of a PaymentIntent without mutating it.',
    inputSchema: z.object({ payment_intent_id: z.string().min(1) }),
    outputSchema: z.union([
      z.object({ ok: z.literal(false), code: z.string(), message: z.string() }),
      z.object({
        ok: z.literal(true),
        paymentIntentId: z.string(),
        status: z.string(),
      }),
    ]),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () =>
    failed(
      'Payment status is unavailable until the governed seller release endpoint is enabled.',
      'payment_release_unavailable',
    ),
);

export default server;
