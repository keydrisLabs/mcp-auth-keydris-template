// Vendored from @keydris/kit-reader v0.1.0, updated to the current gateway
// contract — see ./types.ts for provenance.

import { callsATool, kitActionTokenFrom, tokenFrom } from './token.js';

/** Loopback never leaves the machine, so plaintext is acceptable there — and only there. */
function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    /^127(\.\d{1,3}){3}$/.test(hostname)
  );
}

/**
 * Fails at construction, not at redeem time: a misconfigured gateway URL should
 * surface as one clear error at boot, not as a per-call refusal the agent sees.
 * Redemption posts a live token and receives a raw secret, so a non-loopback
 * `http` endpoint is refused unless explicitly allowed.
 */
function assertRedeemableUrl(raw: string, allowInsecure: boolean): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`gatewayUrl must be an http(s) URL, got ${JSON.stringify(raw)}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`gatewayUrl must be an http(s) URL, got ${JSON.stringify(raw)}`);
  }
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname) && !allowInsecure) {
    throw new Error(
      `gatewayUrl ${JSON.stringify(raw)} is plaintext http to a non-loopback host: ` +
        'the redemption channel carries a live token and returns a raw secret. ' +
        'Use https, or pass allowInsecureGatewayUrl: true for a lab setup.',
    );
  }
}
import type {
  CredentialEnvelope,
  KitActionContext,
  KitReader,
  KitReaderOptions,
  KitTarget,
  Redemption,
} from './types.js';

/**
 * Accepts only the exact envelope shape the gateway publishes. Whatever the
 * gateway (or something impersonating it) returns is about to be applied to an
 * outbound request as a header or query parameter — an unrecognized shape is
 * refused rather than coerced.
 */
function isCredentialEnvelope(value: unknown): value is CredentialEnvelope {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const envelope = value as Record<string, unknown>;
  return (
    (envelope.type === 'header' || envelope.type === 'query') &&
    typeof envelope.name === 'string' &&
    envelope.name.length > 0 &&
    typeof envelope.prefix === 'string' &&
    typeof envelope.value === 'string'
  );
}

/**
 * A reader bound to one gateway. Construct it once at startup and hand it the
 * body of each MCP request; it holds no per-request state, so a single instance
 * serves every connection.
 */
export function createKitReader(options: KitReaderOptions): KitReader {
  const { gatewayUrl } = options;
  assertRedeemableUrl(gatewayUrl, options.allowInsecureGatewayUrl ?? false);
  const tokenHeader = (options.tokenHeader ?? 'authorization')
    .trim()
    .toLowerCase();
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;

  async function exchange(
    token: string,
    context: KitActionContext | undefined,
    target: KitTarget | undefined,
  ): Promise<Redemption> {
    // The gateway's schema pairs them strictly: a KIT action token must arrive
    // with both the MCP action and the downstream target, a legacy header token
    // with neither. A tokenized call without a target is refused here, with a
    // hint at the fix, instead of as an opaque validation error from the wire.
    if (context && !target) {
      return {
        ok: false,
        problem:
          'A KIT action token redemption needs the downstream target (host, path, method) of the request it authorizes.',
      };
    }

    let response: Response;
    try {
      response = await doFetch(gatewayUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          context && target ? { token, ...context, target } : { token },
        ),
        // A hung gateway must not hang the tool call: the agent needs an
        // answer while its own request deadline is still open. Matches the
        // Python reader's default transport timeout.
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { ok: false, problem: 'The Keydris gateway could not be reached.' };
    }

    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const code = (body as { error?: { code?: string } })?.error?.code;
      return {
        ok: false,
        problem: `The Keydris gateway refused: ${code ?? `HTTP ${response.status}`}.`,
      };
    }

    const { credentials } = (body ?? {}) as { credentials?: unknown[] };
    if (!Array.isArray(credentials) || credentials.length === 0) {
      return { ok: false, problem: 'The Keydris gateway released nothing.' };
    }
    if (!credentials.every(isCredentialEnvelope)) {
      return {
        ok: false,
        problem:
          'The Keydris gateway returned a credential in a shape this reader does not recognize.',
      };
    }
    return { ok: true, credentials };
  }

  return {
    tokenHeader,

    callsATool,

    /**
     * Only `tools/call` is touched. Every redemption reveals a secret from the
     * vault, and `initialize`/`tools/list` disclose nothing that would justify
     * one — so a client with no token at all can still connect and see what is
     * on offer, and finds out it needs one only when it asks for something that
     * costs a secret.
     */
    async redeem(body, source) {
      if (!callsATool(body)) {
        return undefined;
      }

      const kitActionToken = kitActionTokenFrom(body);
      if (kitActionToken.problem) {
        return { ok: false, problem: kitActionToken.problem };
      }

      const headerToken = tokenFrom(source?.header);
      if (
        kitActionToken.token &&
        headerToken &&
        kitActionToken.token !== headerToken
      ) {
        return {
          ok: false,
          problem:
            'The MCP request contains conflicting Keydris action and header tokens.',
        };
      }

      const token = kitActionToken.token ?? headerToken;
      if (!token) {
        return {
          ok: false,
          problem: `No Keydris KIT action token in params._meta["keydris/kit_action_token"] or on the ${tokenHeader} header, so there is nothing to exchange for a credential.`,
        };
      }

      return exchange(token, kitActionToken.context, source?.target);
    },
  };
}
