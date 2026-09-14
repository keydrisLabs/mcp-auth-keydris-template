// Vendored from @keydris/kit-reader v0.1.0 — see ./types.ts for provenance.

import type { CredentialEnvelope } from './types.js';

/** Applies released credentials to an outbound request, in place. */
export function applyCredentials(
  credentials: CredentialEnvelope[],
  url: URL,
  headers: Headers,
): void {
  for (const credential of credentials) {
    const value = `${credential.prefix}${credential.value}`;
    if (credential.type === 'query') {
      url.searchParams.set(credential.name, value);
    } else {
      headers.set(credential.name, value);
    }
  }
}
