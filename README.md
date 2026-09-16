# Keydris Stripe MPP MCP templates

Two independently deployable [mcp-use](https://mcp-use.com/) templates for the Stripe Machine Payments Protocol:

- `apps/wallet-mcp` is the buyer wallet. Its `authorize_payment` tool validates a Stripe charge challenge before asking Keydris to authorize spend and issue a bounded Shared Payment Token (SPT).
- `apps/seller-mcp` is the merchant. Its `quote`, `purchase`, `refund`, and `payment_status` tools produce integrity-bound challenges and gate Stripe access through the seller's own Keydris policy.

The apps share payment schemas in `src/payments.ts`. Both install the credential-free Keydris kit reader from `src/keydris` at the MCP transport boundary: each MCP call receives a single-use action token and can redeem it for one outbound request without retaining a Stripe key.

## Current milestone

ENG-265 establishes the server boundaries, schemas, configuration, and safe challenge flow. Money-moving paths intentionally fail closed until Keydris implements the payment-aware release and outcome contracts:

- Wallet SPT issuance requires buyer `payment.spend` evaluation and an `approved_amount` response.
- Seller charging requires a headless seller release evaluated against `payment.spend`.
- Seller refunds require an independent `payment.refund` decision.

Do not replace these guards with the generic credential redemption path. That would release Stripe credentials without enforcing the payment cap.

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

The signed challenge binds SKU, quantity, amount, currency, seller profile, and expiry. The later charge implementation must use durable idempotency and outcome reporting in addition to this integrity check.

## Deploy on Manufact

The apps use separate Manufact projects while remaining in this repository:

```bash
npm run deploy:wallet
npm run deploy:seller
```

Set environment variables through Manufact rather than committing `.env` files. Deployment is intentionally deferred until the payment-aware Keydris endpoints are available; a deployed ENG-265 template would list tools but refuse SPT issuance, charging, and refunds.

## Repository layout

```text
apps/
  wallet-mcp/       buyer authorization and SPT tool
  seller-mcp/       quote, challenge, purchase, and refund tools
src/
  keydris/          shared single-use KIT reader
  payments.ts       shared Stripe MPP schemas and helpers
```

The previous generic GitHub example remains at the repository root as a kit-reader reference; it is not part of the workspace build.
