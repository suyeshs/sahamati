import prompt from "../prompts/knowledge.md" with { type: "text" };

export const knowledgeAgent = {
  description:
    "Performs documentation health checks, identifies gaps and staleness, and generates knowledge base articles like FAQs and how-to guides. Use when the user wants to assess documentation quality or find missing docs.",
  prompt,
  tools: ["Read", "Write", "Glob", "Grep"] as string[],
  model: "haiku" as const,
  maxTurns: 30,
};
