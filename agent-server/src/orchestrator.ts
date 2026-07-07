import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readPrompt } from "./agents/read-prompt.js";
import * as openclawRunner from "./openclaw/runner.js";
import { queryViaCli } from "./claudecode/runner.js";
import { getRunnerMode } from "./runner-config.js";
import { secretsMcpServer } from "./tools/secrets.js";

// Lazy-load the SDK only when needed (avoids credit check on import in CLI mode)
let _query: typeof import("@anthropic-ai/claude-agent-sdk").query | null = null;
async function getSdkQuery() {
  if (!_query) {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    _query = sdk.query;
  }
  return _query;
}

type SdkMcpServers = NonNullable<
  Parameters<typeof import("@anthropic-ai/claude-agent-sdk").query>[0]["options"]
>["mcpServers"];

// Legacy imports kept as fallback
import { discoveryAgent, requirementsAgent, knowledgeAgent, processDocsAgent, evernoteAgent, securityAgent, owaspAgent, vaptAgent, videoAgent } from "./agents/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const orchestratorPrompt = readPrompt("orchestrator.md");
// Loaded lazily so a missing prompt file doesn't break the rest of the orchestrator.
let _secretOrchestratorPrompt: string | null = null;
function getSecretOrchestratorPrompt(): string {
  if (_secretOrchestratorPrompt === null) {
    _secretOrchestratorPrompt = readPrompt("secret-orchestrator.md");
  }
  return _secretOrchestratorPrompt;
}

type AgentDef = {
  description: string;
  prompt: string;
  tools: string[];
  model: "sonnet" | "haiku" | "opus";
  maxTurns: number;
};
// runDirectAgent honors mcpServers at the top-level query options; sub-agents
// passed via the SDK's `agents:` option use a different (ref-style) shape, so
// we keep that field off the shared AgentDef.
type DirectAgentDef = AgentDef & { mcpServers?: SdkMcpServers };

// Doc agent types all route to the single "documentation" OpenClaw agent
const DOC_AGENT_TYPES = ["discovery", "requirements", "knowledge", "process-docs"];

// Prompt prefixes that tell the documentation agent which skill to use
const DOC_SKILL_PREFIX: Record<string, string> = {
  discovery: "[SKILL: discovery] Use your Discovery skill for this task.\n\n",
  requirements: "[SKILL: requirements] Use your Requirements skill for this task.\n\n",
  knowledge: "[SKILL: knowledge] Use your Knowledge skill for this task.\n\n",
  "process-docs": "[SKILL: process-docs] Use your Process Docs skill for this task.\n\n",
};

// Legacy agents used as fallback when OpenClaw agent doesn't exist
const legacyAgents = {
  "discovery-agent": discoveryAgent,
  "requirements-agent": requirementsAgent,
  "knowledge-agent": knowledgeAgent,
  "process-docs-agent": processDocsAgent,
  "evernote-agent": evernoteAgent,
  "security-agent": securityAgent,
  "owasp-agent": owaspAgent,
  "vapt-agent": vaptAgent,
  "video-agent": videoAgent,
};

export interface OrchestratorOptions {
  sessionId?: string;
  resume?: string;
  cwd?: string;
  onMessage?: (msg: unknown) => void;
}

function defaultProjectRoot(): string {
  return process.env.__SAHAMATI_ROOT || resolve(__dirname, "../..");
}

// Build orchestrator sub-agents from OpenClaw agents when available.
// The second return value collects any MCP servers contributed by sub-agents
// so the orchestrator can promote them to its top-level query options. The
// SDK's sub-agent definition uses ref-style mcpServers, not configs — so
// configs live at the top level and sub-agents reference tools by name.
function buildOrchestratorAgents(): {
  agents: Record<string, AgentDef>;
  mcpServers: NonNullable<SdkMcpServers>;
} {
  const agents: Record<string, AgentDef> = {};
  const mcpServers: NonNullable<SdkMcpServers> = {};

  const addLegacy = (key: string, legacy: AgentDef | DirectAgentDef) => {
    const { mcpServers: legacyMcp, ...rest } = legacy as DirectAgentDef;
    agents[key] = rest;
    if (legacyMcp) Object.assign(mcpServers, legacyMcp);
  };

  // Documentation agent (unified)
  const docAgent = openclawRunner.getAgent("documentation");
  if (docAgent) {
    const soulBody = docAgent.soul.replace(/^---[\s\S]*?---\n*/, "").trim();
    const meta = docAgent.soul.match(/^---\n([\s\S]*?)\n---/);
    const description = meta ? (meta[1].match(/description:\s*"([^"]*)"/) || [])[1] || "" : "";

    agents["documentation-agent"] = {
      description: description || "Unified documentation agent for BRDs, FRDs, knowledge base, and process docs",
      prompt: soulBody,
      tools: parseToolsFromContent(docAgent.tools),
      model: resolveModelFromConfig(docAgent.llmProvider, docAgent.llmModel),
      maxTurns: 40,
    };
  } else {
    // Fallback to individual legacy agents
    addLegacy("discovery-agent", discoveryAgent);
    addLegacy("requirements-agent", requirementsAgent);
    addLegacy("knowledge-agent", knowledgeAgent);
    addLegacy("process-docs-agent", processDocsAgent);
  }

  // Evernote agent
  const evernote = openclawRunner.getAgent("evernote");
  if (evernote) {
    const soulBody = evernote.soul.replace(/^---[\s\S]*?---\n*/, "").trim();
    agents["evernote-agent"] = {
      description: "Manages Evernote notes and notebooks - search, read, create, and update notes",
      prompt: soulBody,
      tools: parseToolsFromContent(evernote.tools),
      model: resolveModelFromConfig(evernote.llmProvider, evernote.llmModel),
      maxTurns: 20,
    };
  } else {
    addLegacy("evernote-agent", evernoteAgent);
  }

  return { agents, mcpServers };
}

function parseToolsFromContent(toolsContent: string): string[] {
  const defaultTools = ["Read", "Write", "Glob", "Grep", "Bash", "WebSearch", "WebFetch"];
  if (!toolsContent.trim()) return defaultTools;

  const toolMap: Record<string, string> = {
    "file-read": "Read", "file-write": "Write", "file-search": "Glob",
    "content-search": "Grep", "shell": "Bash", "bash": "Bash",
    "web-search": "WebSearch", "web-fetch": "WebFetch",
    "read": "Read", "write": "Write", "glob": "Glob", "grep": "Grep",
    "websearch": "WebSearch", "webfetch": "WebFetch", "task": "Task",
  };

  const tools: string[] = [];
  for (const line of toolsContent.split("\n")) {
    const match = line.match(/^[\s]*[-*]\s*(?:\*\*)?(\w[\w-]*)(?:\*\*)?/i);
    if (match) {
      const mapped = toolMap[match[1].toLowerCase()];
      if (mapped && !tools.includes(mapped)) tools.push(mapped);
    }
  }
  return tools.length > 0 ? tools : defaultTools;
}

function resolveModelFromConfig(provider: string, model: string): "sonnet" | "haiku" | "opus" {
  if (provider === "anthropic" || provider === "claude") {
    if (model.includes("opus")) return "opus";
    if (model.includes("haiku")) return "haiku";
  }
  return "sonnet";
}

export async function runOrchestrator(
  userPrompt: string,
  options?: OrchestratorOptions
) {
  const projectRoot = options?.cwd ?? defaultProjectRoot();
  const { agents, mcpServers } = buildOrchestratorAgents();
  const subAgentMcpToolNames = Object.values(agents)
    .flatMap((a) => a.tools)
    .filter((t) => t.startsWith("mcp__"));
  const messages: unknown[] = [];

  if (getRunnerMode() === "cli") {
    // CLI mode: run orchestrator prompt directly via Claude Code CLI
    // Note: sub-agent delegation (Task tool) is not available in CLI mode
    const tools = ["Read", "Write", "Glob", "Grep", "Bash", "WebSearch"];
    return queryViaCli(userPrompt, {
      systemPrompt: orchestratorPrompt,
      allowedTools: tools,
      cwd: projectRoot,
      maxTurns: 50,
      onMessage: options?.onMessage,
    });
  }

  const query = await getSdkQuery();
  for await (const message of query({
    prompt: userPrompt,
    options: {
      systemPrompt: orchestratorPrompt,
      allowedTools: [
        "Read", "Write", "Glob", "Grep", "Bash", "Task", "WebSearch",
        ...subAgentMcpToolNames,
      ],
      agents,
      ...(Object.keys(mcpServers).length ? { mcpServers } : {}),
      cwd: projectRoot,
      ...(options?.resume ? { resume: options.resume } : {}),
      ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
      permissionMode: "acceptEdits",
      maxTurns: 50,
    },
  })) {
    messages.push(message);
    options?.onMessage?.(message);
  }

  return messages;
}

/** Identity values the secret orchestrator needs in its system prompt so it
 * can curl back into this same agent-server with the calling admin's email.
 * Both must be non-empty — the orchestrator refuses to run without them. */
export interface SecretOrchestratorContext {
  userEmail: string;
  agentServerUrl: string;
  sessionId?: string;
  onMessage?: (msg: unknown) => void;
}

export async function runSecretOrchestrator(
  userPrompt: string,
  ctx: SecretOrchestratorContext,
) {
  if (!ctx.userEmail || !ctx.agentServerUrl) {
    throw new Error("runSecretOrchestrator requires userEmail and agentServerUrl");
  }

  const projectRoot = defaultProjectRoot();
  const systemPrompt = getSecretOrchestratorPrompt();

  // KMS operations go through typed MCP tools (no Bash/curl). Write/Read/Glob
  // remain so the agent can still surface the env-template path the prompt
  // describes for known apps.
  const allowedTools = [
    "Write",
    "Read",
    "Glob",
    "mcp__secrets__list_keys",
    "mcp__secrets__generate_key",
    "mcp__secrets__rotate_key",
    "mcp__secrets__list_service_tokens",
    "mcp__secrets__mint_service_token",
  ];
  const messages: unknown[] = [];

  if (getRunnerMode() === "cli") {
    return queryViaCli(userPrompt, {
      systemPrompt,
      allowedTools,
      cwd: projectRoot,
      maxTurns: 20,
      onMessage: ctx.onMessage,
    });
  }

  const query = await getSdkQuery();
  for await (const message of query({
    prompt: userPrompt,
    options: {
      systemPrompt,
      allowedTools,
      mcpServers: { secrets: secretsMcpServer },
      cwd: projectRoot,
      permissionMode: "acceptEdits",
      maxTurns: 20,
      model: "sonnet",
      ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
    },
  })) {
    messages.push(message);
    ctx.onMessage?.(message);
  }

  return messages;
}

export async function runDirectAgent(
  agentName: string,
  userPrompt: string,
  options?: OrchestratorOptions
) {
  // Extract the base type (e.g., "discovery-agent" → "discovery")
  const baseType = agentName.replace(/-agent$/, "");

  // Route doc agent types to the unified documentation OpenClaw agent
  if (DOC_AGENT_TYPES.includes(baseType)) {
    const ocAgent = openclawRunner.getAgent("documentation");
    if (ocAgent) {
      const prefix = DOC_SKILL_PREFIX[baseType] || "";
      return openclawRunner.runAgent("documentation", prefix + userPrompt, {
        sessionId: options?.sessionId,
        onMessage: options?.onMessage,
      });
    }
  }

  // Try direct OpenClaw agent match (e.g., "evernote")
  const ocAgent = openclawRunner.getAgent(baseType);
  if (ocAgent) {
    return openclawRunner.runAgent(baseType, userPrompt, {
      sessionId: options?.sessionId,
      onMessage: options?.onMessage,
    });
  }

  // Fallback to legacy agent
  const agent = (legacyAgents as Record<string, DirectAgentDef>)[agentName];
  if (!agent) {
    throw new Error(`Unknown agent: ${agentName}`);
  }

  const projectRoot = options?.cwd ?? defaultProjectRoot();
  const messages: unknown[] = [];

  if (getRunnerMode() === "cli") {
    return queryViaCli(userPrompt, {
      systemPrompt: agent.prompt,
      allowedTools: [...agent.tools],
      cwd: projectRoot,
      maxTurns: agent.maxTurns,
      onMessage: options?.onMessage,
    });
  }

  const query = await getSdkQuery();
  for await (const message of query({
    prompt: userPrompt,
    options: {
      systemPrompt: agent.prompt,
      allowedTools: [...agent.tools],
      cwd: projectRoot,
      ...(options?.resume ? { resume: options.resume } : {}),
      ...(agent.mcpServers ? { mcpServers: agent.mcpServers } : {}),
      permissionMode: "acceptEdits",
      maxTurns: agent.maxTurns,
      model: agent.model,
    },
  })) {
    messages.push(message);
    options?.onMessage?.(message);
  }

  return messages;
}
