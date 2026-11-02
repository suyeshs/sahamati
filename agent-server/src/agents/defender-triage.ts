import { readPrompt } from "./read-prompt.js";
import { DEFENDER_TRIAGE_TOOLS } from "../tools/defender.js";

const prompt = readPrompt("defender-triage.md");

// Read-only: inspects code and advisories, records priority/reachability via a
// typed tool. No Write/Edit/Bash. Runs only through services/defender/run-agent.ts.
export const defenderTriageAgent = {
  name: "defender-triage-agent",
  description:
    "Triages dependency-CVE findings: reads the advisory and the application code, decides reachability and priority, and records the verdict per finding.",
  prompt,
  // ToolSearch is the harness meta-tool that loads deferred MCP schemas; without
  // it the model cannot see the defender tools. It performs no actions itself.
  tools: ["ToolSearch", "Read", "Glob", "Grep", ...DEFENDER_TRIAGE_TOOLS] as string[],
  model: "sonnet" as const,
  maxTurns: 40,
};
