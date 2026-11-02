/**
 * OpenClaw agent runner — now an ADAPTER over the validated, versioned agent
 * registry (see db/repositories/agent-repo.ts). Agent definitions used to live
 * as markdown "soul" folders on disk; they now live as immutable, auditable
 * revisions in the encrypted DB. This module keeps the historical OpenClaw API
 * shape (soul/tools/identity/skills strings) so server.ts routes, the frontend,
 * and the orchestrator keep working — it just translates that shape to and from
 * the flat registry definition.
 *
 * Consequences of the flattening:
 *   - `identity` folds into the system prompt; it is no longer a separate field.
 *   - `heartbeat` is dropped (was never used at runtime).
 *   - per-skill files fold into the system prompt; skills are inline, so the
 *     skill-management API degrades to appending into the prompt.
 * The code-defined assessors (security/owasp/vapt) are NOT here — they stay in
 * version-controlled TS and run via the orchestrator's legacy path.
 */

import { readFileSync, existsSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { queryViaCli } from "../claudecode/runner.js";
import { getRunnerMode } from "../runner-config.js";
import { buildToolGateHooks } from "../tools/permission-gate.js";
import { EMBEDDED_PROMPTS } from "../agents/embedded-prompts.js";
import * as registry from "../db/repositories/agent-repo.js";
import type { AgentDefinition } from "../db/repositories/agent-repo.js";
import type {
  OpenClawAgentSummary,
  OpenClawAgentConfig,
  NewOpenClawAgentRequest,
  UpdateOpenClawAgentRequest,
} from "../types.js";

// Lazy-load the SDK only when needed (avoids credit check on import in CLI mode)
let _query: typeof import("@anthropic-ai/claude-agent-sdk").query | null = null;
async function getSdkQuery() {
  if (!_query) {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    _query = sdk.query;
  }
  return _query;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = process.env.__SAHAMATI_ROOT || resolve(__dirname, "../../..");

const DEFAULT_TOOLS = ["Read", "Write", "Glob", "Grep", "Bash", "WebSearch", "WebFetch"] as const;

// Map an editable TOOLS.md-style tool list (markdown bullets or bare names) to
// registry tool names. Kept from the soul era — this is the last place prose is
// parsed into tools; the registry stores the validated result.
function parseTools(toolsContent: string): AgentDefinition["tools"] {
  const toolMap: Record<string, string> = {
    "file-read": "Read", "file-write": "Write", "file-search": "Glob",
    "content-search": "Grep", "shell": "Bash", "bash": "Bash",
    "web-search": "WebSearch", "web-fetch": "WebFetch",
    "read": "Read", "write": "Write", "edit": "Edit", "multiedit": "MultiEdit",
    "glob": "Glob", "grep": "Grep", "websearch": "WebSearch",
    "webfetch": "WebFetch", "task": "Task",
  };

  const tools: string[] = [];
  for (const line of toolsContent.split("\n")) {
    const match = line.match(/^[\s]*[-*]\s*(?:\*\*)?(\w[\w-]*)(?:\*\*)?/i);
    if (match) {
      const mapped = toolMap[match[1].toLowerCase()];
      if (mapped && !tools.includes(mapped)) tools.push(mapped);
    }
  }
  const result = tools.length > 0 ? tools : [...DEFAULT_TOOLS];
  // Validate against the registry's ToolName enum; unknown names are dropped.
  return result.filter((t): t is AgentDefinition["tools"][number] =>
    registry.ToolName.safeParse(t).success,
  );
}

function resolveModel(provider: string, model: string): AgentDefinition["model"] {
  if (provider === "anthropic" || provider === "claude") {
    if (model.includes("opus")) return "opus";
    if (model.includes("haiku")) return "haiku";
  }
  return "sonnet";
}

/** Strip a leading YAML frontmatter block, if any, leaving the prompt body. */
function stripFrontmatter(text: string): string {
  return text.replace(/^---[\s\S]*?---\n*/, "").trim();
}

/** Compose a system prompt from an (optional) soul body and identity. */
function assemblePrompt(soul: string | undefined, identity: string | undefined, fallback: string): string {
  const body = stripFrontmatter(soul ?? "") || fallback;
  const id = identity?.trim();
  return id ? `${body}\n\n## Identity\n${id}` : body;
}

function renderToolsMarkdown(tools: readonly string[]): string {
  return `# Tools\n\n${tools.map((t) => `- **${t.toLowerCase()}** - ${t}`).join("\n")}\n`;
}

/** Present a registry definition through the historical OpenClaw config shape. */
function defToConfig(name: string, def: AgentDefinition): OpenClawAgentConfig {
  return {
    name,
    soul: `---\nname: "${def.displayName}"\ndescription: "${def.description}"\n---\n\n${def.systemPrompt}`,
    tools: renderToolsMarkdown(def.tools),
    identity: "",
    heartbeat: "",
    llmProvider: def.llmProvider,
    llmModel: def.model,
    skills: [],
  };
}

export function listAgents(): OpenClawAgentSummary[] {
  return registry.listAgents().map((a) => ({
    name: a.name,
    displayName: a.display_name,
    description: a.description,
    llmProvider: "anthropic",
    llmModel: a.model,
    skillCount: 0,
    lastModified: a.updated_at,
  }));
}

export function getAgent(name: string): OpenClawAgentConfig | null {
  const def = registry.getAgentDefinition(name);
  return def ? defToConfig(name, def) : null;
}

export function createAgent(req: NewOpenClawAgentRequest): OpenClawAgentConfig {
  const slug = req.name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
  const systemPrompt = assemblePrompt(
    req.soul,
    req.identity,
    `# ${req.displayName}\n\n${req.displayName}. ${req.description}`,
  );
  registry.createAgent(
    slug,
    {
      displayName: req.displayName,
      description: req.description,
      systemPrompt,
      tools: parseTools(req.tools),
      model: resolveModel(req.llmProvider, req.llmModel),
    },
    { kind: "user", reason: "created via studio" },
  );
  return getAgent(slug)!;
}

export function updateAgent(name: string, req: UpdateOpenClawAgentRequest): OpenClawAgentConfig | null {
  const current = registry.getAgentDefinition(name);
  if (!current) return null;

  const patch: Partial<AgentDefinition> = {};
  if (req.soul !== undefined || req.identity !== undefined) {
    const body = req.soul !== undefined ? stripFrontmatter(req.soul) : current.systemPrompt;
    patch.systemPrompt = req.identity?.trim() ? `${body}\n\n## Identity\n${req.identity.trim()}` : body;
  }
  if (req.tools !== undefined) patch.tools = parseTools(req.tools);
  if (req.llmProvider !== undefined || req.llmModel !== undefined) {
    patch.model = resolveModel(req.llmProvider ?? current.llmProvider, req.llmModel ?? current.model);
  }

  registry.reviseAgent(name, patch, { reason: "updated via studio" });
  return getAgent(name);
}

export function deleteAgent(name: string): boolean {
  try {
    registry.archiveAgent(name);
    return true;
  } catch {
    return false;
  }
}

export async function runAgent(
  name: string,
  prompt: string,
  options: {
    onMessage?: (msg: unknown) => void;
    sessionId?: string;
  } = {},
): Promise<unknown[]> {
  const def = registry.getAgentDefinition(name);
  if (!def) throw new Error(`Agent "${name}" not found`);

  const tools = [...def.tools];
  const messages: unknown[] = [];

  if (getRunnerMode() === "cli") {
    // CLI mode runs Claude Code as a subprocess; the in-process tool gate does
    // not reach it. (Gating the CLI path needs settings-file hooks — follow-up.)
    return queryViaCli(prompt, {
      systemPrompt: def.systemPrompt,
      allowedTools: tools,
      cwd: PROJECT_ROOT,
      maxTurns: def.maxTurns,
      onMessage: options.onMessage,
    });
  }

  const query = await getSdkQuery();
  const gateHooks = buildToolGateHooks({ agentName: name, allowedTools: tools, projectRoot: PROJECT_ROOT });
  for await (const message of query({
    prompt,
    options: {
      systemPrompt: def.systemPrompt,
      allowedTools: tools,
      cwd: PROJECT_ROOT,
      hooks: gateHooks,
      permissionMode: "acceptEdits",
      maxTurns: def.maxTurns,
      model: def.model,
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    },
  })) {
    messages.push(message);
    options.onMessage?.(message);
  }

  return messages;
}

// --- Skills ---------------------------------------------------------------
// Skills are now inline in the system prompt. The per-skill file API is retained
// for route compatibility: installing appends a skill section as a new revision;
// there is no separate skill store to list, read, or remove.

export function listSkills(_agentName: string): Array<{ filename: string; name: string; description: string }> {
  return [];
}

export function installSkill(agentName: string, skillFilename: string, content: string): void {
  const current = registry.getAgentDefinition(agentName);
  if (!current) throw new Error(`Agent "${agentName}" not found`);
  const skillName = skillFilename.replace(/^SKILL-/, "").replace(/\.md$/, "");
  registry.reviseAgent(
    agentName,
    { systemPrompt: `${current.systemPrompt}\n\n## Skill: ${skillName}\n${content.trim()}` },
    { reason: `installed skill ${skillName}` },
  );
}

export function getSkillContent(_agentName: string, _skillFilename: string): string | null {
  return null;
}

export function removeSkill(_agentName: string, _skillFilename: string): boolean {
  return false;
}

// --- Seeding --------------------------------------------------------------

function readBuiltInPrompt(filename: string): string {
  const promptPath = join(PROJECT_ROOT, "agent-server/src/prompts", filename);
  if (existsSync(promptPath)) return readFileSync(promptPath, "utf-8");
  // Compiled binaries / installed bundles ship no source tree — use the copy
  // embedded at build time.
  return EMBEDDED_PROMPTS[filename] ?? "";
}

const DOC_ROUTING_PROMPT = `# Documentation Agent

You are the Documentation Agent for the Sahamati system. You handle all documentation tasks across the software development lifecycle.

## How You Work

You have four specialized skills. When given a task, identify which skill applies and follow its workflow:

1. **Discovery** — Generate Business Requirements Documents (BRDs) from meeting notes, project descriptions, or stakeholder conversations
2. **Requirements** — Transform approved BRDs into Functional Requirements Documents (FRDs) and user stories with acceptance criteria
3. **Knowledge** — Run documentation health checks, identify gaps and staleness, generate knowledge base articles
4. **Process Docs** — Connect to GitHub repositories and generate architecture overviews, deployment runbooks, dev standards, API docs, and setup guides

## Routing Rules

- If the user mentions **BRD, business requirements, meeting notes, project idea, or stakeholder input** → use the Discovery skill
- If the user mentions **FRD, functional requirements, user stories, acceptance criteria, or references an existing BRD** → use the Requirements skill
- If the user mentions **documentation health, gaps, staleness, FAQ, knowledge base, or how-to guides** → use the Knowledge skill
- If the user mentions **GitHub repo, codebase analysis, architecture, deployment, runbook, SOP, API docs, or setup guide** → use the Process Docs skill
- If unclear, ask the user which documentation task they need

## Output Standards

- Always include YAML frontmatter with title, generated_by, date, confidence score
- Write generated docs to \`docs/generated/\` under the appropriate subdirectory
- Mark incomplete sections with \`<!-- NEEDS INPUT: description -->\`
- Return a summary of what was generated with file paths and confidence scores`;

function buildDocumentationPrompt(): string {
  const skills = ["discovery", "requirements", "knowledge", "process-docs"]
    .map((s) => `## Skill: ${s}\n\n${readBuiltInPrompt(`${s}.md`)}`.trim())
    .filter(Boolean)
    .join("\n\n---\n\n");
  return `${DOC_ROUTING_PROMPT}\n\n${skills}`;
}

/** Idempotently seed the built-in agents into the registry. */
export function seedBuiltInAgents(): void {
  const seedIfAbsent = (name: string, def: AgentDefinition) => {
    if (registry.getAgent(name)) return; // row exists (any status) → leave it
    registry.createAgent(name, def, { kind: "built_in", reason: "seeded built-in" });
  };

  seedIfAbsent("documentation", {
    displayName: "Documentation Agent",
    description:
      "Unified documentation agent with skills for discovery (BRD), requirements (FRD), knowledge base, and process docs",
    systemPrompt: buildDocumentationPrompt(),
    tools: [...DEFAULT_TOOLS],
    model: "sonnet",
    maxTurns: 40,
    llmProvider: "anthropic",
  });

  seedIfAbsent("evernote", {
    displayName: "Evernote Agent",
    description: "Manages Evernote notes and notebooks - search, read, create, and update notes",
    systemPrompt: readBuiltInPrompt("evernote.md") || "You are the Evernote agent.",
    tools: ["Read", "Write", "Bash", "Glob", "Grep"],
    model: "sonnet",
    maxTurns: 20,
    llmProvider: "anthropic",
  });
}
