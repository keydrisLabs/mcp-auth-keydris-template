# Keydris Stripe MPP MCP templates

Two independently deployable [mcp-use](https://mcp-use.com/) templates for the Stripe Machine Payments Protocol:

- `apps/wallet-mcp` is the buyer wallet. Its `authorize_payment` tool validates a Stripe charge challenge before asking Keydris to authorize spend and issue a bounded Shared Payment Token (SPT).
- `apps/seller-mcp` is the merchant. Its `quote`, `purchase`, `refund`, and `payment_status` tools produce integrity-bound challenges and gate Stripe access through the seller's own Keydris policy.

The apps share payment schemas in `src/payments.ts`. Both install the credential-free Keydris kit reader from `src/keydris` at the MCP transport boundary: each MCP call receives a single-use action token and can redeem it for one outbound request without retaining a Stripe key.

## Payment-aware KIT flow

Each money-moving tool includes a strict `payment` object in its MCP parameters. The action token binds those parameters. At redemption, the kit reader sends the same context separately so Keydris can evaluate `payment.spend` or `payment.refund`; the gateway refuses any context that does not exactly match the token-bound parameters.

After an allow decision, the gateway returns the approved payment values, decision ID, and non-secret Stripe connection evidence. The reader verifies that evidence before making one outbound request. The wallet resolves its PaymentMethod from the approved buyer connection, while the seller can use only a seller connection for PaymentIntents and refunds. Stripe credentials remain inside the one-shot fetch path.

The templates use Stripe API version `2026-07-29.preview`. Stripe redirects are not followed, and stable `request_id` values become Stripe idempotency keys.

## Install and check

Requires Node 22.22.2 or newer.

```bash
npm install
npm run typecheck
npm run build
```

Run either Inspector locally:

```bash
npm run dev:wallet
npm run dev:seller
```

Each command is run separately because both apps listen on the same default development port.

## Wallet configuration

Copy `apps/wallet-mcp/.env.example` to `apps/wallet-mcp/.env` and set:

| Variable | Required | Purpose |
| --- | --- | --- |
| `KEYDRIS_GATEWAY_URL` | No | Buyer Keydris credential-redemption endpoint. Defaults to the Keydris development gateway. |
| `KEYDRIS_TOKEN_HEADER` | No | Legacy action-token header; defaults to `authorization`. |

The MCP request normally carries `keydris/kit_action_token` in `params._meta`.

## Seller configuration

Copy `apps/seller-mcp/.env.example` to `apps/seller-mcp/.env` and set:

| Variable | Required | Purpose |
| --- | --- | --- |
| `KEYDRIS_GATEWAY_URL` | No | Seller Keydris credential-redemption endpoint. Defaults to the Keydris development gateway. |
| `KEYDRIS_TOKEN_HEADER` | No | Legacy action-token header; defaults to `authorization`. |
| `STRIPE_NETWORK_ID` | Yes | Seller network business profile placed in each challenge. |
| `SELLER_CHALLENGE_SIGNING_SECRET` | Yes | At least 32 characters; integrity-binds the quoted purchase. |
| `SELLER_CATALOG_JSON` | Yes | Server-authoritative products, amounts, and currencies. |
| `SELLER_CHALLENGE_TTL_SECONDS` | No | Challenge lifetime; defaults to 300 and is capped at 600 seconds. |

The signed challenge binds SKU, quantity, amount, currency, seller profile, and expiry. `purchase` validates it against the server-authoritative catalog before confirming a PaymentIntent. `refund` uses the separate `payment.refund` policy path.

## Deploy on Manufact

The apps use separate Manufact projects while remaining in this repository:

```bash
npm run deploy:wallet
npm run deploy:seller
```

Set environment variables through Manufact rather than committing `.env` files. Deploy the backend payment-aware gateway changes before pointing a hosted template at it.

## Repository layout

```text
apps/
  wallet-mcp/       buyer authorization and SPT tool
  seller-mcp/       quote, challenge, purchase, and refund tools
src/
  keydris/          shared single-use KIT reader
  payments.ts       shared Stripe MPP schemas and helpers
  stripe.ts         exact minor-unit conversion and Stripe request helpers
```

The previous generic GitHub example remains at the repository root as a kit-reader reference; it is not part of the workspace build.
