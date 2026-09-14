# keydris-manufact-template: Credential-Free MCP Server Template for mcp-use

**A template for building credential-free MCP servers with [mcp-use](https://mcp-use.com/), with the Keydris kit reader wired in as middleware. The server holds no API key, no PAT, no secret of any kind: it redeems a single-use, action-scoped KIT action token for the credential each tool call needs, at call time.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
![Node](https://img.shields.io/badge/Node-22+-5FA04E?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![mcp-use](https://img.shields.io/badge/mcp--use-2.4-purple)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/mHN8z7qYRV)

---

<p align="center">
  <img src="public/icon.svg" alt="keydris-manufact-template" width="96" />
  &nbsp;&nbsp;
  <img src="public/keydris-logo.png" alt="Keydris" width="96" />
</p>

<p align="center">
  An MCP server that holds no credential of its own. One single-use token, one action, one call.
</p>

<p align="center">
  <a href="https://keydris.com/">Website</a> ·
  <a href="https://discord.gg/mHN8z7qYRV">Discord</a> ·
  <a href="https://github.com/keydrisLabs/keydris-reader">keydris-reader</a> ·
  <a href="https://mcp-use.com/docs/typescript/getting-started/quickstart">mcp-use docs</a>
</p>

---

## What this is

This is a **template**, not a finished server: clone it, keep the middleware, and replace the demo tool with your own. It was bootstrapped with [`create-mcp-use-app`](https://mcp-use.com/docs/typescript/getting-started/quickstart) and adds the **Keydris kit reader** as mcp-use middleware, following the upstream [keydris-reader](https://github.com/keydrisLabs/keydris-reader) libraries.

> **Requires a Keydris account.** The tokens this server redeems are minted and evaluated by the Keydris proxy, gateway, and vault. Sign up at [keydris.com](https://keydris.com/) to get a gateway URL to redeem against; without one, the server starts and lists its tools, but every credentialed call is refused.

---

## The flow

```
proxy ──► POST /mcp
          params._meta["keydris/kit_action_token"] = token
                                                  ──► this server
          tool builds its upstream request, then:
          this server ──► POST {KEYDRIS_GATEWAY_URL}
                          {token, mcp:{method,action_name,parameters},
                                  target:{host,path,method}}
                       ◄── {credentials:[{type,name,prefix,value}]}
          this server ──► the upstream API, credential applied
```

For each `tools/call`, the server redeems the single-use **KIT action token** the Keydris proxy injected on `params._meta["keydris/kit_action_token"]` (or, as a legacy fallback, on the `authorization` header) for the credential that one call needs — at the moment the outbound request is made, because the gateway requires the downstream `target` alongside the action.

---

## How the template is wired

- `src/keydris/` — the kit reader. `token.ts` and `credentials.ts` are vendored verbatim from [`@keydris/kit-reader`](https://github.com/keydrisLabs/keydris-reader/tree/main/node/packages/kit-reader); `types.ts` and `redeem.ts` are vendored and updated to the current gateway contract (the upstream package predates the `target` requirement); `middleware.ts` is the mcp-use adapter.
- `index.ts` registers the middleware once: `server.use("mcp:tools/call", keydrisCredentials(reader))`. It does not redeem — it **arms a one-shot spend** bound to the wire-exact MCP call. Only `tools/call` is armed; `initialize` and `tools/list` never touch the gateway, so a client with no token can still connect and see what is on offer.
- Inside a tool, make the one credentialed request with `keydrisFetch(ctx, url, init)` — it derives the target from the URL, redeems, injects the credential, and sends. See the `github-whoami` tool. For custom transports, `kitSpendFrom(ctx)` returns the raw spend and `applyCredentials(...)` does the injection.
- One token authorizes **one** outbound request: the gateway consumes it atomically, and a second spend is refused locally. Failures arrive as `{ ok: false, problem }` and are returned as tool errors the agent can read, never thrown. Never log `credentials` (the `problem` side is safe to log).

---

## Getting Started

### Prerequisites

- A [Keydris](https://keydris.com/) account, and the gateway URL it gives you to redeem against
- Node 22+

### Run the development server

```bash
npm install
npm run dev
```

Open [http://localhost:3000/mcp/inspector](http://localhost:3000/mcp/inspector) with your browser to test your server.

You can start building by editing the entry file. Add tools and prompts — the server auto-reloads as you edit.

Run `npm run typecheck` to refresh MCP view types and check the project with its local TypeScript compiler.

---

## Configuration

Configure via `.env` (see `.env.example`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `KEYDRIS_GATEWAY_URL` | _(required — no fallback)_ | Where this server redeems the KIT action token it was handed. Must be `https` unless loopback. Unset, the server starts and lists tools, but every credentialed call refuses with a problem naming this variable. |
| `KEYDRIS_TOKEN_HEADER` | `authorization` | Legacy header accepted as a fallback; tokens normally arrive in MCP `params._meta`. |
| `GITHUB_API_BASE` | `https://api.github.com` | Upstream API base for the `github-whoami` demo tool. |

---

## Learn More

To learn more about mcp-use, MCP, and the kit reader:

- [mcp-use Documentation](https://mcp-use.com/docs/typescript/getting-started/quickstart) — guides, API reference, and tutorials
- [keydris-reader](https://github.com/keydrisLabs/keydris-reader) — the upstream Node and Python kit-reader libraries this template vendors
- [keydris.com](https://keydris.com/) — the proxy, gateway, and vault the tokens are redeemed against

---

## Deploy on Manufact Cloud

```bash
npm run deploy
```
