import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getProfile, searchMessages, getMessage, gmailConfigured } from "./gmail-client.js";

export { gmailConfigured };

const __dirname = dirname(fileURLToPath(import.meta.url));
const isBunBinary = __dirname.startsWith("/$bunfs");

/**
 * MCP server entry for the Claude Code CLI runner (--mcp-config). The CLI
 * runs agents in a subprocess, so the in-process SDK server below can't reach
 * it — instead the CLI launches `index.ts gmail-mcp` (see gmail-mcp-stdio.ts)
 * with the Gmail credentials passed explicitly. Null when unconfigured, so
 * the agent degrades to explaining setup.
 */
export function gmailCliMcpServers(): Record<string, unknown> | null {
  if (!gmailConfigured()) return null;
  const tsEntry = join(__dirname, "..", "index.ts");
  const launcher = isBunBinary
    ? { command: process.execPath, args: ["gmail-mcp"] }
    : existsSync(tsEntry)
      ? { command: "bun", args: [tsEntry, "gmail-mcp"] }
      : { command: "node", args: [join(__dirname, "..", "index.js"), "gmail-mcp"] };
  return {
    gmail: {
      ...launcher,
      env: {
        GMAIL_CLIENT_ID: process.env.GMAIL_CLIENT_ID!,
        GMAIL_CLIENT_SECRET: process.env.GMAIL_CLIENT_SECRET!,
        GMAIL_REFRESH_TOKEN: process.env.GMAIL_REFRESH_TOKEN!,
      },
    },
  };
}

function asJson(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

// Read-only on purpose: no send, modify, label, or delete tools. Mailbox
// content is personal data — the agent triages it, it never mutates it.
export const gmailMcpServer = createSdkMcpServer({
  name: "gmail",
  version: "1.0.0",
  tools: [
    tool(
      "get_profile",
      "Get the connected Gmail account's own email address. Call this first — classification (directly addressed, cc'd, mentioned) is relative to this address.",
      {},
      async () => asJson(await getProfile()),
    ),
    tool(
      "search_messages",
      'Search messages with Gmail query grammar (e.g. "in:inbox newer_than:7d", "label:X", "to:me -from:me"). Returns header-level summaries (from, to, cc, subject, date, list-id, labels, snippet) — enough to triage most mail without reading bodies.',
      {
        query: z.string().min(1).describe("Gmail search query"),
        max_results: z.number().int().min(1).max(50).optional()
          .describe("Messages to return (default 25, max 50)"),
      },
      async ({ query, max_results }) => asJson(await searchMessages(query, max_results)),
    ),
    tool(
      "get_message",
      "Read one message's plain-text body (plus headers) by ID. Use only when headers and snippet aren't enough — e.g. to check whether the user is mentioned by name in a thread they're cc'd on.",
      { id: z.string().describe("Message ID from search_messages") },
      async ({ id }) => asJson(await getMessage(id)),
    ),
  ],
});
