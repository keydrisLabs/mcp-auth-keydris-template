import { completable, MCPServer } from "mcp-use";
import { z } from "zod";
import { config } from "./src/config.js";
import { parseUser, userRequest } from "./src/github.js";
import {
  createKitReader,
  keydrisCredentials,
  keydrisFetch,
} from "./src/keydris/index.js";

const server = new MCPServer({
  name: "keydris-manufact-template",
  title: "keydris-manufact-template",
  version: "1.0.0",
  description:
    "An MCP server built with mcp-use. Holds no credential of its own: for each tool call, the Keydris kit reader middleware redeems the action-scoped token the Keydris proxy injected for the credential that call needs.",
});

// One reader for the process: it holds no per-request state, only where to
// redeem and which legacy header to fall back to. With no gateway configured
// the server still starts and lists its tools; the middleware refuses every
// credentialed call with a problem naming the missing variable.
const reader = config.gatewayUrl
  ? createKitReader({
      gatewayUrl: config.gatewayUrl,
      tokenHeader: config.tokenHeader,
    })
  : null;

// Arms each tools/call with a one-shot spend of its KIT action token —
// initialize and tools/list never touch the gateway. Tools spend it at fetch
// time via keydrisFetch(ctx, url, init), when the downstream target is known.
server.use("mcp:tools/call", keydrisCredentials(reader));

function failed(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

export const githubWhoami = server.tool(
  {
    name: "github-whoami",
    description:
      "Returns the GitHub account the credential released by the Keydris gateway belongs to.",
    inputSchema: z.object({}),
    outputSchema: z.object({
      login: z.string(),
      name: z.string().nullable(),
      htmlUrl: z.string(),
      publicRepos: z.number(),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (_input, ctx) => {
    const { url, init } = userRequest();

    try {
      // One tool call, one outbound request: keydrisFetch redeems this call's
      // token for the credential this exact request needs, applies it, and
      // sends it. The secret never appears in tool code.
      const result = await keydrisFetch(ctx, url, init);
      if (!result.ok) {
        return failed(result.problem);
      }
      if (!result.response.ok) {
        return failed(
          `GitHub rejected the released credential with ${result.response.status}.`,
        );
      }

      const user = parseUser(await result.response.json());
      return {
        content: [
          {
            type: "text" as const,
            text: `Authenticated as ${user.login}${user.name ? ` (${user.name})` : ""}, ${user.publicRepos} public repos.`,
          },
        ],
        structuredContent: user,
      };
    } catch {
      return failed("The GitHub request could not be completed.");
    }
  }
);

export const fetchWeather = server.tool(
  {
    name: "fetch-weather",
    description: "Return demo weather for a city",
    inputSchema: z.object({ city: z.string() }),
    outputSchema: z.object({
      city: z.string(),
      conditions: z.string(),
      temperature: z.string(),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ city }) => {
    const weather = { city, conditions: "sunny", temperature: "22°C" };
    return {
      content: [{ type: "text", text: JSON.stringify(weather) }],
      structuredContent: weather,
    };
  }
);

server.prompt(
  {
    name: "review-code",
    description: "Review code for correctness and maintainability",
    schema: z.object({
      language: completable(z.string(), [
        "typescript",
        "javascript",
        "python",
        "go",
      ]),
      code: z.string(),
    }),
  },
  async ({ language, code }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Review this ${language} code:\n\n${code}`,
        },
      },
    ],
  })
);

export default server;
