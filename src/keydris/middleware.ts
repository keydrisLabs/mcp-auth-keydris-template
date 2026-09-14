// The mcp-use adapter for the kit reader: local code, not vendored.
//
// The gateway redeems a KIT action token only together with the downstream
// target (host, path, method) of the request it authorizes — which is known
// inside the tool at fetch time, not when the MCP request arrives. So the
// middleware does not redeem: it arms a one-shot spend bound to the wire-exact
// MCP call, and the tool spends it on the one outbound request it makes.

import { getRequestBag, type McpExactMiddlewareFn } from 'mcp-use';
import { applyCredentials } from './credentials.js';
import type {
  KitReader,
  KitTarget,
  Redemption,
  TargetMethod,
} from './types.js';

/** The per-request context variable the middleware leaves the spend on. */
export const KIT_SPEND_VAR = 'keydris/kit-spend';

/**
 * One request's chance to redeem. Callable once: the gateway consumes the
 * token atomically on release, so a second call is refused locally with a
 * readable problem instead of a wire round-trip that cannot succeed.
 */
export type KitSpend = (target: KitTarget) => Promise<Redemption>;

declare module 'hono' {
  interface ContextVariableMap {
    'keydris/kit-spend': KitSpend;
  }
}

/**
 * The slice of a tool's request context the kit reader needs. Structural, so
 * both mcp-use's `RequestContext` and a bare test double satisfy it.
 */
type SpendContext = {
  get?: (key: typeof KIT_SPEND_VAR) => KitSpend | undefined;
};

/**
 * Arms each `tools/call` with a one-shot spend for the token the Keydris proxy
 * injected (or the legacy header fallback). Tools spend it via `keydrisFetch`
 * or `kitSpendFrom`. Nothing here touches the gateway, so `initialize` and
 * `tools/list` stay free: a client with no token can still connect and see
 * what is on offer. Everything that stops a credential arriving lands as
 * `{ ok: false, problem }` for the tool handler to report, rather than as a
 * protocol failure the agent cannot read.
 */
export function keydrisCredentials(
  /** `null` = no gateway configured: the server stays up, spends refuse. */
  reader: KitReader | null,
): McpExactMiddlewareFn<'tools/call'> {
  return async (ctx, next) => {
    if (!reader) {
      ctx.set(KIT_SPEND_VAR, async () => ({
        ok: false as const,
        problem:
          'The Keydris gateway URL is not configured: set KEYDRIS_GATEWAY_URL to your redemption endpoint.',
      }));
      return next();
    }
    // The gateway recomputes the intent hash from the parameters we send and
    // compares it to the one minted from the wire, so the redemption must be
    // built from the wire-exact body — schema validation may have stripped or
    // defaulted fields in ctx.params by the time the tool runs.
    const raw = ctx.request?.raw;
    const body = (raw ? getRequestBag(raw).parsedBody : undefined) ?? {
      method: ctx.method,
      params: ctx.params,
    };
    const header = ctx.request?.header(reader.tokenHeader);

    let spent = false;
    ctx.set(KIT_SPEND_VAR, async (target) => {
      if (spent) {
        return {
          ok: false,
          problem:
            'The KIT action token for this request was already spent: one token authorizes one outbound call.',
        };
      }
      spent = true;
      return (
        (await reader.redeem(body, { header, target })) ?? {
          ok: false,
          problem:
            'This MCP request calls no tool, so there is no action token to redeem.',
        }
      );
    });
    return next();
  };
}

/**
 * The spend `keydrisCredentials` armed for the current tool call. Never
 * `undefined`: when the middleware is not registered (or the request reached
 * the tool outside the HTTP pipeline) the caller gets a readable problem
 * instead of a crash.
 */
export function kitSpendFrom(ctx: SpendContext): KitSpend {
  const spend =
    typeof ctx.get === 'function' ? ctx.get(KIT_SPEND_VAR) : undefined;
  return (
    spend ??
    (async () => ({
      ok: false,
      problem:
        'The Keydris kit reader middleware is not armed for this request.',
    }))
  );
}

/**
 * The upstream response, or the reason no credentialed request could be made.
 * Upstream HTTP failures are not folded in: a 401 from the API is still an
 * `ok: true` result carrying that response, for the tool to interpret.
 */
export type KeydrisFetchResult =
  | { ok: true; response: Response }
  | { ok: false; problem: string };

const TARGET_METHODS: ReadonlySet<string> = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
] satisfies TargetMethod[]);

/**
 * Spends the request's KIT action token on one outbound call: derives the
 * target from the URL (hostname without port, path without query — the shape
 * the gateway matches vault entries and policy against), redeems, applies the
 * released credentials, and performs the fetch. The secret never leaves this
 * call's stack.
 */
export async function keydrisFetch(
  ctx: SpendContext,
  input: string | URL,
  init?: RequestInit,
): Promise<KeydrisFetchResult> {
  const url = new URL(input);
  const method = (init?.method ?? 'GET').toUpperCase();
  if (!TARGET_METHODS.has(method)) {
    return {
      ok: false,
      problem: `The Keydris gateway cannot authorize the HTTP method ${method}.`,
    };
  }

  const redemption = await kitSpendFrom(ctx)({
    host: url.hostname,
    path: url.pathname || '/',
    method: method as TargetMethod,
  });
  if (!redemption.ok) {
    return { ok: false, problem: redemption.problem };
  }

  const headers = new Headers(init?.headers);
  applyCredentials(redemption.credentials, url, headers);
  return { ok: true, response: await fetch(url, { ...init, method, headers }) };
}
