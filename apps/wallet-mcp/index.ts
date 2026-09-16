import { MCPServer } from 'mcp-use';
import { z } from 'zod';
import {
  createKitReader,
  keydrisCredentials,
  keydrisFetch,
} from '../../src/keydris/index.js';
import {
  failed,
  isExpired,
  normalizeAmount,
  paymentContextSchema,
  stripeChallengeSchema,
} from '../../src/payments.js';
import {
  STRIPE_API_BASE,
  stripePayload,
  stripeRequest,
  toMinorUnits,
} from '../../src/stripe.js';

const gatewayUrl =
  process.env.KEYDRIS_GATEWAY_URL ??
  'https://dev.api.keydris.com/gateway/credentials';
const reader = gatewayUrl
  ? createKitReader({
      gatewayUrl,
      tokenHeader: process.env.KEYDRIS_TOKEN_HEADER,
    })
  : null;

const server = new MCPServer({
  name: 'keydris-wallet-mcp',
  title: 'Keydris Wallet MCP',
  version: '0.1.0',
  description:
    'Buyer wallet for authorizing Stripe MPP challenges under Keydris policy.',
});

server.use('mcp:tools/call', keydrisCredentials(reader));

const authorizationResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    challengeId: z.string(),
    spt: z.string(),
    stripeStatus: z.string(),
  }),
  z.object({
    ok: z.literal(false),
    code: z.string(),
    message: z.string(),
  }),
]);

const issuedTokenSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['active', 'requires_action', 'deactivated']),
});

export const authorizePayment = server.tool(
  {
    name: 'authorize_payment',
    description:
      'Authorize a Stripe MPP charge challenge against the buyer policy and issue a bounded shared payment token.',
    inputSchema: z.object({
      challenge: stripeChallengeSchema,
      payment: paymentContextSchema.extend({
        transaction_type: z.literal('spend'),
      }),
      request_id: z.string().min(1).describe('Stable idempotency key'),
    }),
    outputSchema: authorizationResultSchema,
    annotations: { readOnlyHint: false, openWorldHint: true },
  },
  async ({ challenge, payment, request_id }, ctx) => {
    if (isExpired(challenge.expiresAt)) {
      return failed('The payment challenge has expired.', 'challenge_expired');
    }
    if (
      normalizeAmount(payment.amount) !== normalizeAmount(challenge.amount) ||
      payment.currency !== challenge.currency
    ) {
      return failed(
        'The payment policy context does not match the seller challenge.',
        'payment_context_mismatch',
      );
    }

    try {
      const result = await keydrisFetch(
        ctx,
        `${STRIPE_API_BASE}/v1/shared_payment/issued_tokens`,
        {
          method: 'POST',
          build: (release) => {
            const paymentMethod = release.paymentConnection?.payment_method_id;
            if (release.paymentConnection?.role !== 'buyer' || !paymentMethod) {
              throw new Error(
                'The approved Stripe connection is not a configured buyer wallet.',
              );
            }
            return stripeRequest(
              {
                payment_method: paymentMethod,
                'seller_details[network_business_profile]': challenge.networkId,
                'usage_limits[max_amount]': toMinorUnits(
                  challenge.amount,
                  challenge.currency,
                ),
                'usage_limits[currency]': challenge.currency.toLowerCase(),
                'usage_limits[expires_at]': Math.floor(
                  new Date(challenge.expiresAt).getTime() / 1000,
                ),
              },
              request_id,
            );
          },
        },
        { payment, reference: { challenge_id: challenge.id } },
      );
      if (!result.ok) return failed(result.problem, 'payment_denied');
      const payload = issuedTokenSchema.parse(
        await stripePayload(result.response),
      );
      if (payload.status !== 'active') {
        return failed(
          `Stripe requires additional buyer action (${payload.status}).`,
          'stripe_action_required',
        );
      }
      return {
        content: [
          { type: 'text' as const, text: 'Payment authorization approved.' },
        ],
        structuredContent: {
          ok: true as const,
          challengeId: challenge.id,
          spt: payload.id,
          stripeStatus: payload.status,
        },
      };
    } catch (error) {
      return failed(
        error instanceof Error ? error.message : 'Stripe authorization failed.',
        'stripe_error',
      );
    }
  },
);

export default server;
