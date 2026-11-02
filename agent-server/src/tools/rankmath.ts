import type { McpHttpServerConfig } from "@anthropic-ai/claude-agent-sdk";

/**
 * Rank Math (WordPress SEO plugin) ships an MCP server inside the plugin from
 * v1.0.272: Streamable HTTP at /wp-json/mcp/mcp-adapter-default-server, backed
 * by the WordPress Abilities API. Auth is a WordPress Application Password
 * (Users → Profile → Application Passwords) sent as HTTP Basic auth.
 *
 * Env (agent-server/.env):
 *   RANKMATH_WP_URL           — WordPress site origin, e.g. https://blog.example.com
 *   RANKMATH_WP_USERNAME      — WordPress user the Application Password belongs to
 *   RANKMATH_WP_APP_PASSWORD  — the Application Password (not the login password)
 */
export function rankMathMcpServer(): McpHttpServerConfig | null {
  const site = process.env.RANKMATH_WP_URL;
  const username = process.env.RANKMATH_WP_USERNAME;
  const appPassword = process.env.RANKMATH_WP_APP_PASSWORD;
  if (!site || !username || !appPassword) return null;

  return {
    type: "http",
    url: new URL("/wp-json/mcp/mcp-adapter-default-server", site).toString(),
    headers: {
      Authorization:
        "Basic " + Buffer.from(`${username}:${appPassword}`).toString("base64"),
    },
  };
}
