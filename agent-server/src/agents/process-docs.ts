import { readPrompt } from "./read-prompt.js";
import { githubMcpServer } from "../tools/github.js";

const prompt = readPrompt("process-docs.md");

export const processDocsAgent = {
  description:
    "Connects to a GitHub repository and generates traditional process/SOP documentation including architecture overview, deployment runbook, development standards, operations guide, API docs, and setup guide.",
  prompt,
  tools: [
    "Read",
    "Write",
    "Glob",
    "Grep",
    "Bash",
    "WebSearch",
    "WebFetch",
    "mcp__github__clone_repo",
  ] as string[],
  mcpServers: { github: githubMcpServer },
  model: "sonnet" as const,
  maxTurns: 40,
};
