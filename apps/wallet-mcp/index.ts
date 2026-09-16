import { MCPServer } from 'mcp-use';
import { z } from 'zod';
import { createKitReader, keydrisCredentials } from '../../src/keydris/index.js';
import {
  failed,
  isExpired,
  normalizeAmount,
  stripeChallengeSchema,
} from '../../src/payments.js';

const gatewayUrl =
  process.env.KEYDRIS_GATEWAY_URL ??
  'https://dev.api.keydris.com/gateway/crendentials';
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

export const authorizePayment = server.tool(
  {
    name: 'authorize_payment',
    description:
      'Authorize a Stripe MPP charge challenge against the buyer policy and issue a bounded shared payment token.',
    inputSchema: z.object({
      challenge: stripeChallengeSchema,
      payment_connection_id: z
        .string()
        .min(1)
        .describe('Buyer Stripe PAYMENT AppConnection id'),
      request_id: z.string().min(1).describe('Stable idempotency key'),
    }),
    outputSchema: authorizationResultSchema,
    annotations: { readOnlyHint: false, openWorldHint: true },
  },
  async ({ challenge }) => {
    if (isExpired(challenge.expiresAt)) {
      return failed('The payment challenge has expired.', 'challenge_expired');
    }

    // ENG-265 deliberately stops here. The current Keydris redemption contract
    // does not accept payment context or return an approved amount. Issuing an
    // SPT through the generic credential path would bypass payment.spend.
    return failed(
      `Payment authorization is unavailable until the payment-aware Keydris release contract is enabled for ${normalizeAmount(challenge.amount)} ${challenge.currency}.`,
      'payment_release_unavailable',
    );
  },
);

export default server;
