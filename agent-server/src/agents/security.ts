import { readPrompt } from "./read-prompt.js";

const prompt = readPrompt("security.md");

export const securityAgent = {
  description:
    "Performs comprehensive security assessments of codebases. Scans for hardcoded secrets, authentication flaws, injection vulnerabilities, misconfigurations, and generates a detailed Security Assessment Report following OWASP Top 10 and CWE standards.",
  prompt,
  tools: ["Read", "Write", "Glob", "Grep", "Bash"] as string[],
  model: "sonnet" as const,
  maxTurns: 50,
};
