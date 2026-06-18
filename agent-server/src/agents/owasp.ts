import { readPrompt } from "./read-prompt.js";

const prompt = readPrompt("owasp.md");

export const owaspAgent = {
  description:
    "Assesses a web application or API against the OWASP Top 10 (2021) and ASVS 4.0 from its source and architecture. Walks every Top 10 category, maps findings to CWE/CVSS, and produces an OWASP Assessment Report with a non-destructive, operator-driven test plan. Does not execute live attacks.",
  prompt,
  tools: ["Read", "Write", "Glob", "Grep", "Bash"] as string[],
  model: "sonnet" as const,
  maxTurns: 50,
};
