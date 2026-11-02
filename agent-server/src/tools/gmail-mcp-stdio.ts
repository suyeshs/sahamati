/**
 * Stdio MCP server exposing the read-only Gmail tools to the Claude Code CLI.
 *
 * The cli runner executes agents in a `claude` subprocess, so the in-process
 * SDK MCP server in gmail.ts can't reach it. This module speaks the MCP stdio
 * protocol (newline-delimited JSON-RPC) and is launched by the CLI itself via
 * --mcp-config as `agent-server gmail-mcp` (compiled sidecar) or
 * `bun src/index.ts gmail-mcp` (dev).
 *
 * stdout is the protocol channel — never log to it here; use stderr.
 */

import { getProfile, searchMessages, getMessage } from "./gmail-client.js";

const TOOL_DEFS = [
  {
    name: "get_profile",
    description:
      "Get the connected Gmail account's own email address. Call this first — classification (directly addressed, cc'd, mentioned) is relative to this address.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "search_messages",
    description:
      'Search messages with Gmail query grammar (e.g. "in:inbox newer_than:7d", "label:X", "to:me -from:me"). Returns header-level summaries (from, to, cc, subject, date, list-id, labels, snippet) — enough to triage most mail without reading bodies.',
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, description: "Gmail search query" },
        max_results: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "Messages to return (default 25, max 50)",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_message",
    description:
      "Read one message's plain-text body (plus headers) by ID. Use only when headers and snippet aren't enough — e.g. to check whether the user is mentioned by name in a thread they're cc'd on.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Message ID from search_messages" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "get_profile":
      return getProfile();
    case "search_messages":
      return searchMessages(String(args.query), args.max_results as number | undefined);
    case "get_message":
      return getMessage(String(args.id));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

function send(payload: Record<string, unknown>) {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

function reply(id: number | string | null, result: unknown) {
  send({ jsonrpc: "2.0", id, result });
}

function replyError(id: number | string | null, code: number, message: string) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(req: JsonRpcRequest) {
  // Notifications (no id) need no response.
  if (req.id === undefined && req.method.startsWith("notifications/")) return;
  const id = req.id ?? null;

  switch (req.method) {
    case "initialize":
      reply(id, {
        protocolVersion: (req.params?.protocolVersion as string) ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "gmail", version: "1.0.0" },
      });
      return;
    case "ping":
      reply(id, {});
      return;
    case "tools/list":
      reply(id, { tools: TOOL_DEFS });
      return;
    case "tools/call": {
      const name = String(req.params?.name ?? "");
      const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await callTool(name, args);
        reply(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        });
      } catch (err) {
        reply(id, {
          content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        });
      }
      return;
    }
    default:
      if (req.id !== undefined) replyError(id, -32601, `Method not found: ${req.method}`);
  }
}

/** Serve MCP over stdio until stdin closes and in-flight requests drain. */
export function runGmailMcpStdio(): Promise<void> {
  return new Promise((resolve) => {
    let buffer = "";
    const inflight = new Set<Promise<void>>();
    const finish = () => {
      // Requests may still be awaiting the Gmail API when stdin closes —
      // don't exit until every reply has been written.
      Promise.allSettled([...inflight]).then(() => resolve());
    };
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const p = handle(JSON.parse(trimmed) as JsonRpcRequest).finally(() => inflight.delete(p));
          inflight.add(p);
        } catch {
          process.stderr.write(`[gmail-mcp] unparseable line: ${trimmed.slice(0, 120)}\n`);
        }
      }
    });
    process.stdin.on("end", finish);
    process.stdin.on("close", finish);
  });
}
