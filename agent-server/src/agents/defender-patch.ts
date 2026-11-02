import { readPrompt } from "./read-prompt.js";
import { DEFENDER_PATCH_TOOLS } from "../tools/defender.js";

const prompt = readPrompt("defender-patch.md");

// Proposes bumps; every mutation (manifest edit, lockfile regen, install, tests,
// branch, PR) is a typed tool that validates against the finding row. Humans
// merge. No Write/Edit/Bash. Runs only through services/defender/run-agent.ts.
export const defenderPatchAgent = {
  name: "defender-patch-agent",
  description:
    "Remediates selected dependency-CVE findings by proposing version bumps, verifying them with the project's tests in an isolated workspace, and opening a pull request for human review.",
  prompt,
  // ToolSearch loads deferred MCP schemas (see defender-triage.ts).
  tools: ["ToolSearch", "Read", ...DEFENDER_PATCH_TOOLS] as string[],
  model: "sonnet" as const,
  maxTurns: 30,
};
