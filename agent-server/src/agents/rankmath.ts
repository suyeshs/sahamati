import { readPrompt } from "./read-prompt.js";
import { rankMathMcpServer } from "../tools/rankmath.js";

const prompt = readPrompt("rankmath.md");

export const rankMathAgent = {
  description:
    "Fetches and presents WordPress SEO data from Rank Math — site audits, post SEO meta, link reports, and schema. Use when the user wants to see or review SEO data for a WordPress site.",
  prompt,
  // mcp__rankmath (no tool suffix) allows every tool the WordPress MCP
  // adapter exposes — the ability set varies by Rank Math version/plan, so we
  // can't pin exact tool names the way the evernote agent does.
  tools: ["Read", "Write", "Glob", "Grep", "mcp__rankmath"] as string[],
  // Resolved lazily so an unconfigured site (missing env) degrades to "agent
  // explains how to configure" instead of crashing agent registration.
  get mcpServers() {
    const server = rankMathMcpServer();
    return server ? { rankmath: server } : undefined;
  },
  model: "sonnet" as const,
  maxTurns: 20,
};
