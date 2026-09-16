import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { stripeChallengeSchema, type StripeChallenge } from '../../../src/payments.js';

const payloadSchema = stripeChallengeSchema.extend({
  sku: z.string().min(1),
  quantity: z.number().int().positive(),
});

type ChallengePayload = z.infer<typeof payloadSchema>;

function signature(encoded: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(encoded).digest();
}

export function issueChallenge(
  payload: Omit<ChallengePayload, 'id'>,
  secret: string,
): StripeChallenge {
  if (secret.length < 32) {
    throw new Error('SELLER_CHALLENGE_SIGNING_SECRET must be at least 32 characters');
  }
  const unsigned = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = signature(unsigned, secret).toString('base64url');
  return stripeChallengeSchema.parse({ ...payload, id: `ch_${unsigned}.${mac}` });
}

export function verifyChallenge(id: string, secret: string): ChallengePayload {
  const match = /^ch_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(id);
  if (!match) throw new Error('The challenge id is malformed.');

  const [, encoded, encodedMac] = match;
  const expected = signature(encoded, secret);
  const received = Buffer.from(encodedMac, 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new Error('The challenge signature is invalid.');
  }
  return payloadSchema.parse(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')));
}
