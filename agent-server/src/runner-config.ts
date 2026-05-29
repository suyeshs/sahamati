/**
 * Runner mode configuration.
 *
 * Set AGENT_RUNNER=cli in .env to use Claude Code CLI (subscription credits).
 * Set AGENT_RUNNER=sdk (default) to use @anthropic-ai/claude-agent-sdk (API credits).
 */

export type RunnerMode = "cli" | "sdk";

export function getRunnerMode(): RunnerMode {
  const mode = (process.env.AGENT_RUNNER || "sdk").toLowerCase();
  if (mode === "cli") return "cli";
  return "sdk";
}
