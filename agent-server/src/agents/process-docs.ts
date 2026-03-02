import prompt from "../prompts/process-docs.md" with { type: "text" };

export const processDocsAgent = {
  description:
    "Connects to a GitHub repository and generates traditional process/SOP documentation including architecture overview, deployment runbook, development standards, operations guide, API docs, and setup guide.",
  prompt,
  tools: ["Read", "Write", "Glob", "Grep", "Bash", "WebSearch", "WebFetch"] as string[],
  model: "sonnet" as const,
  maxTurns: 40,
};
