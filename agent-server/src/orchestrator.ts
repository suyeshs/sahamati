import { query } from "@anthropic-ai/claude-agent-sdk";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { discoveryAgent, requirementsAgent, knowledgeAgent, processDocsAgent } from "./agents/index.js";
import orchestratorPrompt from "./prompts/orchestrator.md" with { type: "text" };

const __dirname = dirname(fileURLToPath(import.meta.url));
const isBunBinary = __dirname.startsWith("/$bunfs");

const agents = {
  "discovery-agent": discoveryAgent,
  "requirements-agent": requirementsAgent,
  "knowledge-agent": knowledgeAgent,
  "process-docs-agent": processDocsAgent,
};

export interface OrchestratorOptions {
  sessionId?: string;
  resume?: string;
  cwd?: string;
  onMessage?: (msg: unknown) => void;
}

function defaultProjectRoot(): string {
  if (isBunBinary) {
    return resolve(dirname(process.execPath), "../..");
  }
  return resolve(__dirname, "../..");
}

export async function runOrchestrator(
  userPrompt: string,
  options?: OrchestratorOptions
) {
  const projectRoot = options?.cwd ?? defaultProjectRoot();

  const messages: unknown[] = [];

  for await (const message of query({
    prompt: userPrompt,
    options: {
      systemPrompt: orchestratorPrompt,
      allowedTools: ["Read", "Write", "Glob", "Grep", "Bash", "Task", "WebSearch"],
      agents,
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

export async function runDirectAgent(
  agentName: keyof typeof agents,
  userPrompt: string,
  options?: OrchestratorOptions
) {
  const agent = agents[agentName];
  if (!agent) {
    throw new Error(`Unknown agent: ${agentName}`);
  }

  const projectRoot = options?.cwd ?? defaultProjectRoot();
  const messages: unknown[] = [];

  for await (const message of query({
    prompt: userPrompt,
    options: {
      systemPrompt: agent.prompt,
      allowedTools: [...agent.tools],
      cwd: projectRoot,
      ...(options?.resume ? { resume: options.resume } : {}),
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
