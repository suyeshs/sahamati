import { readPrompt } from "./read-prompt.js";

const prompt = readPrompt("discovery.md");

export const discoveryAgent = {
  description:
    "Generates Business Requirements Documents (BRDs) from meeting notes, project descriptions, or stakeholder conversations. Use when the user provides raw input about a project idea or business need.",
  prompt,
  tools: ["Read", "Write", "Glob", "Grep", "WebSearch", "WebFetch"] as string[],
  model: "sonnet" as const,
  maxTurns: 30,
};
