import { readPrompt } from "./read-prompt.js";

const prompt = readPrompt("requirements.md");

export const requirementsAgent = {
  description:
    "Transforms existing BRDs into Functional Requirements Documents (FRDs) and user stories with acceptance criteria. Use when a BRD already exists and the user wants detailed requirements or user stories.",
  prompt,
  tools: ["Read", "Write", "Glob", "Grep"] as string[],
  model: "sonnet" as const,
  maxTurns: 40,
};
