// Runs a defender agent with the Claude Agent SDK directly. This path never
// enters runDirectAgent, so the DB agent registry cannot shadow a defender
// agent by name and the CLI runner (which skips the permission gate) is never
// used. Always SDK mode, always gated.

import { buildToolGateHooks } from "../../tools/permission-gate.js";
import { createDefenderMcpServer, type DefenderRunContext } from "../../tools/defender.js";
import { getRunnerMode } from "../../runner-config.js";

let _query: typeof import("@anthropic-ai/claude-agent-sdk").query | null = null;
async function getSdkQuery() {
  if (!_query) {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    _query = sdk.query;
  }
  return _query;
}

export interface DefenderAgentDef {
  name: string;
  description: string;
  prompt: string;
  tools: readonly string[];
  model: "sonnet" | "haiku" | "opus";
  maxTurns: number;
}

export interface RunAgentOptions {
  onMessage?: (msg: unknown) => void | Promise<void>;
  sessionId?: string;
}

export function sdkCredentialsAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_USE_BEDROCK || process.env.CLAUDE_CODE_USE_VERTEX);
}

export async function runDefenderAgent(agent: DefenderAgentDef, userPrompt: string, ctx: DefenderRunContext, opts: RunAgentOptions = {}): Promise<unknown[]> {
  if (getRunnerMode() === "cli") {
    console.warn("[defender] AGENT_RUNNER=cli is ignored for defender agents: they always run in gated SDK mode");
  }
  if (!sdkCredentialsAvailable()) {
    throw new Error("defender agents need ANTHROPIC_API_KEY (or a Bedrock/Vertex configuration) on the agent-server");
  }

  const server = createDefenderMcpServer(ctx);
  const projectRoot = ctx.repoDir;
  const hooks = buildToolGateHooks({
    agentName: agent.name,
    allowedTools: agent.tools,
    projectRoot,
    branchPolicy: { allowedPrefixes: ["defender/"] },
    denyInstalls: true,
    // The checkout is the only thing a defender agent may read: a live run
    // was observed grepping Claude Code transcripts under ~/.claude otherwise.
    confineReads: true,
  });

  const query = await getSdkQuery();
  const messages: unknown[] = [];
  const log = ctx.log ?? ((line: string) => console.log(`[defender:${ctx.runId.slice(0, 8)}] ${line}`));
  for await (const message of query({
    prompt: userPrompt,
    options: {
      // Surface the CLI's stderr (auth errors, startup failures) in the run log
      // instead of losing it when the subprocess exits non-zero.
      stderr: (chunk: string) => {
        const line = chunk.trim();
        if (line) log(`sdk: ${line.slice(0, 500)}`);
      },
      systemPrompt: agent.prompt,
      allowedTools: [...agent.tools],
      mcpServers: { defender: server },
      cwd: ctx.repoDir,
      hooks,
      permissionMode: "acceptEdits",
      maxTurns: agent.maxTurns,
      // Hard spend cap per agent run; scheduled triage must not run away.
      maxBudgetUsd: Number(process.env.SAHAMATI_DEFENDER_MAX_BUDGET_USD ?? 5),
      model: agent.model,
      ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
    },
  })) {
    messages.push(message);
    await opts.onMessage?.(message);
  }
  return messages;
}
