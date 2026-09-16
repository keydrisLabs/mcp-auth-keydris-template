import { z } from 'zod';
import { amountSchema, currencySchema } from '../../../src/payments.js';

const productSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  unitAmount: amountSchema,
  currency: currencySchema,
});

export type Product = z.infer<typeof productSchema>;

function catalogFromEnvironment(): Map<string, Product> {
  const raw = process.env.SELLER_CATALOG_JSON ?? '[]';
  const products = z.array(productSchema).parse(JSON.parse(raw));
  const catalog = new Map(products.map((product) => [product.sku, product]));
  if (catalog.size !== products.length) {
    throw new Error('SELLER_CATALOG_JSON contains duplicate sku values');
  }
  return catalog;
}

const requestedTtl = Number(process.env.SELLER_CHALLENGE_TTL_SECONDS ?? '300');

export const config = {
  gatewayUrl:
    process.env.KEYDRIS_GATEWAY_URL ??
    'https://dev.api.keydris.com/gateway/crendentials',
  tokenHeader: process.env.KEYDRIS_TOKEN_HEADER,
  networkId: process.env.STRIPE_NETWORK_ID ?? '',
  signingSecret: process.env.SELLER_CHALLENGE_SIGNING_SECRET ?? '',
  challengeTtlSeconds:
    Number.isInteger(requestedTtl) && requestedTtl > 0
      ? Math.min(requestedTtl, 600)
      : 300,
  catalog: catalogFromEnvironment(),
} as const;
