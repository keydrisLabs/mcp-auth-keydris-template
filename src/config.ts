export const config = {
  /**
   * Where this server redeems the token it was handed. No fallback: a default
   * pointing anywhere would either bake someone's tenant URL into a public
   * template or silently send live tokens over plaintext. Unset, the server
   * still starts and lists its tools — every credentialed call refuses with a
   * problem naming this variable.
   */
  gatewayUrl: process.env.KEYDRIS_GATEWAY_URL ?? '',

  /**
   * Legacy `/agent/authorize` header accepted as a fallback. `mcp_kit_reader`
   * requests carry their action-scoped token in MCP params._meta instead.
   * The reader normalizes (trims and lowercases) it.
   */
  tokenHeader: process.env.KEYDRIS_TOKEN_HEADER,

  githubApiBase: process.env.GITHUB_API_BASE ?? 'https://api.github.com',
} as const;
