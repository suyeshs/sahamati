import { readPrompt } from "./read-prompt.js";

const prompt = readPrompt("vapt.md");

export const vaptAgent = {
  description:
    "Performs Vulnerability Assessment and Penetration Testing analysis of an in-scope application: source-driven recon, STRIDE threat model, OWASP/CWE vulnerability assessment, and a scoped, non-destructive penetration-test plan for operator execution via the authorized pentest tooling. Produces a formal VAPT Report; does not launch live attacks itself.",
  prompt,
  tools: ["Read", "Write", "Glob", "Grep", "Bash"] as string[],
  model: "sonnet" as const,
  maxTurns: 60,
};
