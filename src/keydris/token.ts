// Vendored from @keydris/kit-reader v0.1.0 — see ./types.ts for provenance.

import type { TokenLookup } from './types.js';

/** The MCP `params._meta` key an `mcp_kit_reader` proxy injects the token on. */
export const KIT_ACTION_TOKEN_META_KEY = 'keydris/kit_action_token';

/**
 * Accepts both `Bearer <jwt>` and a bare token, since the header the proxy uses is
 * configurable and only the default carries a scheme.
 */
export function tokenFrom(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) {
    return undefined;
  }
  return /^bearer\s+/i.test(value) ? value.replace(/^bearer\s+/i, '') : value;
}

/**
 * Reads the action-scoped token injected by an `mcp_kit_reader` proxy and the
 * exact tool arguments it authorized. Batched tokenized actions are refused:
 * one KIT action token can be redeemed for one action only.
 */
export function kitActionTokenFrom(body: unknown): TokenLookup {
  const messages = Array.isArray(body) ? body : [body];
  let lookup: TokenLookup = {};

  for (const message of messages) {
    if ((message as { method?: string })?.method !== 'tools/call') {
      continue;
    }
    const params = (message as { params?: unknown }).params;
    const meta =
      params && typeof params === 'object'
        ? (params as { _meta?: unknown })._meta
        : undefined;
    const raw =
      meta && typeof meta === 'object'
        ? (meta as Record<string, unknown>)[KIT_ACTION_TOKEN_META_KEY]
        : undefined;
    if (raw === undefined) {
      continue;
    }
    const token = typeof raw === 'string' ? tokenFrom(raw) : undefined;
    if (!token) {
      return { problem: 'The Keydris KIT action token is malformed.' };
    }
    if (lookup.token) {
      return {
        problem:
          'A KIT action token can authorize only one MCP action per request.',
      };
    }
    const call = params as {
      name?: unknown;
      arguments?: unknown;
    };
    if (
      typeof call.name !== 'string' ||
      !call.name ||
      (call.arguments !== undefined &&
        (typeof call.arguments !== 'object' ||
          call.arguments === null ||
          Array.isArray(call.arguments)))
    ) {
      return { problem: 'The tokenized MCP tool call is malformed.' };
    }
    lookup = {
      token,
      context: {
        mcp: {
          method: 'tools/call',
          action_name: call.name,
          parameters: (call.arguments ?? {}) as Record<string, unknown>,
        },
      },
    };
  }
  return lookup;
}

/** Whether the JSON-RPC body — one message or a batch — invokes a tool. */
export function callsATool(body: unknown): boolean {
  const messages = Array.isArray(body) ? body : [body];
  return messages.some(
    (message) => (message as { method?: string })?.method === 'tools/call',
  );
}
