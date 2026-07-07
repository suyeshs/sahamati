import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { queryViaCli } from "../claudecode/runner.js";
import { getRunnerMode } from "../runner-config.js";
import { EMBEDDED_PROMPTS } from "../agents/embedded-prompts.js";

// Lazy-load the SDK only when needed (avoids credit check on import in CLI mode)
let _query: typeof import("@anthropic-ai/claude-agent-sdk").query | null = null;
async function getSdkQuery() {
  if (!_query) {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    _query = sdk.query;
  }
  return _query;
}
import type {
  OpenClawAgentSummary,
  OpenClawAgentConfig,
  NewOpenClawAgentRequest,
  UpdateOpenClawAgentRequest,
} from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = process.env.__SAHAMATI_ROOT || resolve(__dirname, "../../..");

const WORKSPACE_ROOT = join(PROJECT_ROOT, "openclaw-agents");

function ensureWorkspace(): void {
  if (!existsSync(WORKSPACE_ROOT)) {
    mkdirSync(WORKSPACE_ROOT, { recursive: true });
  }
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
  return meta;
}

function readFileOr(path: string, fallback: string): string {
  return existsSync(path) ? readFileSync(path, "utf-8") : fallback;
}

function readAgentJson(agentDir: string): Record<string, unknown> {
  const configPath = join(agentDir, "openclaw.json");
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

// Map LLM provider/model strings to Claude Agent SDK model values
function resolveModel(provider: string, model: string): string {
  if (provider === "anthropic" || provider === "claude") {
    if (model.includes("opus")) return "opus";
    if (model.includes("haiku")) return "haiku";
    return "sonnet";
  }
  // Default to sonnet for other providers (Claude Agent SDK only supports Anthropic)
  return "sonnet";
}

// Map tools string from TOOLS.md to allowed tool names
function parseTools(toolsContent: string): string[] {
  const defaultTools = ["Read", "Write", "Glob", "Grep", "Bash", "WebSearch", "WebFetch"];
  if (!toolsContent.trim()) return defaultTools;

  const tools: string[] = [];
  const toolMap: Record<string, string> = {
    "file-read": "Read",
    "file-write": "Write",
    "file-search": "Glob",
    "content-search": "Grep",
    "shell": "Bash",
    "bash": "Bash",
    "web-search": "WebSearch",
    "web-fetch": "WebFetch",
    "read": "Read",
    "write": "Write",
    "glob": "Glob",
    "grep": "Grep",
    "websearch": "WebSearch",
    "webfetch": "WebFetch",
    "task": "Task",
  };

  // Parse tool names from markdown list items or YAML-like entries
  const lines = toolsContent.split("\n");
  for (const line of lines) {
    const match = line.match(/^[\s]*[-*]\s*(?:\*\*)?(\w[\w-]*)(?:\*\*)?/i);
    if (match) {
      const name = match[1].toLowerCase();
      const mapped = toolMap[name];
      if (mapped && !tools.includes(mapped)) {
        tools.push(mapped);
      }
    }
  }

  return tools.length > 0 ? tools : defaultTools;
}

export function listAgents(): OpenClawAgentSummary[] {
  ensureWorkspace();
  const entries = readdirSync(WORKSPACE_ROOT, { withFileTypes: true });
  const agents: OpenClawAgentSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const agentDir = join(WORKSPACE_ROOT, entry.name);
    const soulPath = join(agentDir, "SOUL.md");
    if (!existsSync(soulPath)) continue;

    const soulContent = readFileSync(soulPath, "utf-8");
    const meta = parseFrontmatter(soulContent);
    const config = readAgentJson(agentDir);
    const skillsDir = join(agentDir, "skills");
    const skillCount = existsSync(skillsDir)
      ? readdirSync(skillsDir).filter((f) => f.startsWith("SKILL-") && f.endsWith(".md")).length
      : 0;

    const stat = statSync(soulPath);

    agents.push({
      name: entry.name,
      displayName: meta.name || meta.title || entry.name,
      description: meta.description || "",
      llmProvider: String(config.llmProvider || "anthropic"),
      llmModel: String(config.llmModel || "sonnet"),
      skillCount,
      lastModified: stat.mtime.toISOString(),
    });
  }

  return agents;
}

export function getAgent(name: string): OpenClawAgentConfig | null {
  const agentDir = join(WORKSPACE_ROOT, name);
  if (!existsSync(join(agentDir, "SOUL.md"))) return null;

  const config = readAgentJson(agentDir);
  const skillsDir = join(agentDir, "skills");
  const skills = existsSync(skillsDir)
    ? readdirSync(skillsDir).filter((f) => f.startsWith("SKILL-") && f.endsWith(".md"))
    : [];

  return {
    name,
    soul: readFileOr(join(agentDir, "SOUL.md"), ""),
    tools: readFileOr(join(agentDir, "TOOLS.md"), ""),
    identity: readFileOr(join(agentDir, "IDENTITY.md"), ""),
    heartbeat: readFileOr(join(agentDir, "HEARTBEAT.md"), ""),
    llmProvider: String(config.llmProvider || "anthropic"),
    llmModel: String(config.llmModel || "sonnet"),
    skills,
  };
}

export function createAgent(req: NewOpenClawAgentRequest): OpenClawAgentConfig {
  ensureWorkspace();
  const safeName = req.name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
  const agentDir = join(WORKSPACE_ROOT, safeName);

  if (existsSync(agentDir)) {
    throw new Error(`Agent "${safeName}" already exists`);
  }

  mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(agentDir, "skills"), { recursive: true });

  const soulContent = `---
name: "${req.displayName}"
description: "${req.description}"
---

${req.soul || `# ${req.displayName}\n\nYou are ${req.displayName}. ${req.description}`}`;

  writeFileSync(join(agentDir, "SOUL.md"), soulContent);
  writeFileSync(join(agentDir, "TOOLS.md"), req.tools || defaultToolsContent());
  writeFileSync(join(agentDir, "IDENTITY.md"), req.identity || defaultIdentityContent(req.displayName));
  writeFileSync(
    join(agentDir, "openclaw.json"),
    JSON.stringify(
      {
        llmProvider: req.llmProvider || "anthropic",
        llmModel: req.llmModel || "sonnet",
      },
      null,
      2
    )
  );

  return getAgent(safeName)!;
}

export function updateAgent(name: string, req: UpdateOpenClawAgentRequest): OpenClawAgentConfig | null {
  const agentDir = join(WORKSPACE_ROOT, name);
  if (!existsSync(join(agentDir, "SOUL.md"))) return null;

  if (req.soul !== undefined) writeFileSync(join(agentDir, "SOUL.md"), req.soul);
  if (req.tools !== undefined) writeFileSync(join(agentDir, "TOOLS.md"), req.tools);
  if (req.identity !== undefined) writeFileSync(join(agentDir, "IDENTITY.md"), req.identity);
  if (req.heartbeat !== undefined) writeFileSync(join(agentDir, "HEARTBEAT.md"), req.heartbeat);

  if (req.llmProvider !== undefined || req.llmModel !== undefined) {
    const config = readAgentJson(agentDir);
    if (req.llmProvider) config.llmProvider = req.llmProvider;
    if (req.llmModel) config.llmModel = req.llmModel;
    writeFileSync(join(agentDir, "openclaw.json"), JSON.stringify(config, null, 2));
  }

  return getAgent(name);
}

export function deleteAgent(name: string): boolean {
  const agentDir = join(WORKSPACE_ROOT, name);
  if (!existsSync(agentDir)) return false;
  rmSync(agentDir, { recursive: true, force: true });
  return true;
}

export async function runAgent(
  name: string,
  prompt: string,
  options: {
    onMessage?: (msg: unknown) => void;
    sessionId?: string;
  } = {}
): Promise<unknown[]> {
  const agent = getAgent(name);
  if (!agent) throw new Error(`Agent "${name}" not found`);

  // Build system prompt from SOUL.md + IDENTITY.md + skills
  const soulBody = agent.soul.replace(/^---[\s\S]*?---\n*/, "").trim();
  const identityBody = agent.identity.trim();
  const skillPrompts = loadSkillPrompts(name);

  const systemPrompt = [
    soulBody,
    identityBody ? `\n## Identity\n${identityBody}` : "",
    skillPrompts ? `\n## Skills\n${skillPrompts}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const tools = parseTools(agent.tools);
  const model = resolveModel(agent.llmProvider, agent.llmModel);
  const agentDir = join(WORKSPACE_ROOT, name);
  const config = readAgentJson(agentDir);
  const maxTurns = typeof config.maxTurns === "number" ? config.maxTurns : 30;
  const messages: unknown[] = [];

  if (getRunnerMode() === "cli") {
    return queryViaCli(prompt, {
      systemPrompt,
      allowedTools: tools,
      cwd: PROJECT_ROOT,
      maxTurns,
      onMessage: options.onMessage,
    });
  }

  const query = await getSdkQuery();
  for await (const message of query({
    prompt,
    options: {
      systemPrompt,
      allowedTools: tools,
      cwd: PROJECT_ROOT,
      permissionMode: "acceptEdits",
      maxTurns,
      model: model as "sonnet" | "haiku" | "opus",
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    },
  })) {
    messages.push(message);
    options.onMessage?.(message);
  }

  return messages;
}

function loadSkillPrompts(agentName: string): string {
  const skillsDir = join(WORKSPACE_ROOT, agentName, "skills");
  if (!existsSync(skillsDir)) return "";

  const skills = readdirSync(skillsDir).filter(
    (f) => f.startsWith("SKILL-") && f.endsWith(".md")
  );

  return skills
    .map((f) => {
      const content = readFileSync(join(skillsDir, f), "utf-8");
      // Strip frontmatter, return body
      return content.replace(/^---[\s\S]*?---\n*/, "").trim();
    })
    .filter(Boolean)
    .join("\n\n---\n\n");
}

function defaultToolsContent(): string {
  return `# Tools

- **read** - Read files from the filesystem
- **write** - Write files to the filesystem
- **glob** - Search for files by pattern
- **grep** - Search file contents
- **bash** - Execute shell commands
- **web-search** - Search the web
- **web-fetch** - Fetch web pages
`;
}

function defaultIdentityContent(name: string): string {
  return `# Identity

You are **${name}**, a helpful AI assistant. You communicate clearly and concisely, focusing on delivering accurate and actionable responses.
`;
}

// Skill management
export function listSkills(agentName: string): Array<{ filename: string; name: string; description: string }> {
  const skillsDir = join(WORKSPACE_ROOT, agentName, "skills");
  if (!existsSync(skillsDir)) return [];

  return readdirSync(skillsDir)
    .filter((f) => f.startsWith("SKILL-") && f.endsWith(".md"))
    .map((filename) => {
      const content = readFileSync(join(skillsDir, filename), "utf-8");
      const meta = parseFrontmatter(content);
      return {
        filename,
        name: meta.name || filename.replace(/^SKILL-/, "").replace(/\.md$/, ""),
        description: meta.description || "",
      };
    });
}

export function installSkill(
  agentName: string,
  skillFilename: string,
  content: string
): void {
  const skillsDir = join(WORKSPACE_ROOT, agentName, "skills");
  mkdirSync(skillsDir, { recursive: true });
  const safeName = skillFilename.startsWith("SKILL-") ? skillFilename : `SKILL-${skillFilename}`;
  const finalName = safeName.endsWith(".md") ? safeName : `${safeName}.md`;
  writeFileSync(join(skillsDir, finalName), content);
}

export function getSkillContent(agentName: string, skillFilename: string): string | null {
  const skillPath = join(WORKSPACE_ROOT, agentName, "skills", skillFilename);
  if (!existsSync(skillPath)) return null;
  return readFileSync(skillPath, "utf-8");
}

export function removeSkill(agentName: string, skillFilename: string): boolean {
  const skillPath = join(WORKSPACE_ROOT, agentName, "skills", skillFilename);
  if (!existsSync(skillPath)) return false;
  rmSync(skillPath);
  return true;
}

// Seed built-in agents into OpenClaw workspace on first run
export function seedBuiltInAgents(): void {
  ensureWorkspace();

  // --- Documentation Agent (with 4 sub-agent skills) ---
  seedDocumentationAgent();

  // --- Evernote Agent (standalone) ---
  seedSimpleAgent({
    name: "evernote",
    displayName: "Evernote Agent",
    description: "Manages Evernote notes and notebooks - search, read, create, and update notes",
    soul: readBuiltInPrompt("evernote.md"),
    tools: ["Read", "Write", "Bash", "Glob", "Grep"],
    model: "sonnet",
    maxTurns: 20,
  });

  // NOTE: security / owasp / vapt are intentionally NOT seeded as OpenClaw souls.
  // They are first-class Anthropic (Claude Agent SDK) agents defined in code under
  // agent-server/src/agents/{security,owasp,vapt}.ts with version-controlled prompts,
  // per-agent tool allow-lists, and pinned models — run via runDirectAgent. Keeping
  // the security assessors code-defined (not runtime-editable souls) preserves
  // auditability for the regulated AA context.
}

function seedDocumentationAgent(): void {
  const name = "documentation";
  const agentDir = join(WORKSPACE_ROOT, name);

  // Don't overwrite if already exists
  if (existsSync(join(agentDir, "SOUL.md"))) return;

  mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(agentDir, "skills"), { recursive: true });

  // SOUL.md — unified documentation agent
  const soulContent = `---
name: "Documentation Agent"
description: "Unified documentation agent with sub-skills for discovery (BRD), requirements (FRD), knowledge base, and process docs generation"
built_in: true
---

# Documentation Agent

You are the Documentation Agent for the Sahamati system. You handle all documentation tasks across the software development lifecycle.

## How You Work

You have **four specialized skills** installed. When given a task, identify which skill applies and follow its workflow:

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
- Return a summary of what was generated with file paths and confidence scores
`;

  writeFileSync(join(agentDir, "SOUL.md"), soulContent);

  // TOOLS.md — superset of all sub-agent tools
  writeFileSync(join(agentDir, "TOOLS.md"), `# Tools

- **read** - Read files from the filesystem
- **write** - Write files to the filesystem
- **glob** - Search for files by pattern
- **grep** - Search file contents
- **bash** - Execute shell commands
- **web-search** - Search the web
- **web-fetch** - Fetch web pages
`);

  // IDENTITY.md
  writeFileSync(join(agentDir, "IDENTITY.md"), `# Identity

You are the **Documentation Agent**, a professional technical writer and analyst. You generate high-quality, actionable documentation following established templates and best practices. You communicate clearly, write in professional business and technical language, and always provide structured outputs with confidence scores.
`);

  // openclaw.json
  writeFileSync(
    join(agentDir, "openclaw.json"),
    JSON.stringify(
      {
        llmProvider: "anthropic",
        llmModel: "sonnet",
        maxTurns: 40,
        builtIn: true,
      },
      null,
      2
    )
  );

  // Install the 4 doc sub-agent skills
  const subSkills: Array<{ filename: string; content: string }> = [
    {
      filename: "SKILL-discovery.md",
      content: buildSkillContent(
        "discovery",
        "Generate Business Requirements Documents (BRDs) from meeting notes, project descriptions, or stakeholder conversations",
        readBuiltInPrompt("discovery.md")
      ),
    },
    {
      filename: "SKILL-requirements.md",
      content: buildSkillContent(
        "requirements",
        "Transform BRDs into Functional Requirements Documents (FRDs) and user stories with acceptance criteria",
        readBuiltInPrompt("requirements.md")
      ),
    },
    {
      filename: "SKILL-knowledge.md",
      content: buildSkillContent(
        "knowledge",
        "Documentation health checks, gap analysis, and knowledge base article generation",
        readBuiltInPrompt("knowledge.md")
      ),
    },
    {
      filename: "SKILL-process-docs.md",
      content: buildSkillContent(
        "process-docs",
        "Connect to GitHub repos and generate architecture overview, deployment runbook, dev standards, API docs, and setup guides",
        readBuiltInPrompt("process-docs.md")
      ),
    },
  ];

  for (const skill of subSkills) {
    writeFileSync(join(agentDir, "skills", skill.filename), skill.content);
  }
}

function buildSkillContent(name: string, description: string, prompt: string): string {
  return `---\nname: "${name}"\ndescription: "${description}"\n---\n\n${prompt}`;
}

function seedSimpleAgent(def: {
  name: string;
  displayName: string;
  description: string;
  soul: string;
  tools: string[];
  model: string;
  maxTurns: number;
}): void {
  const agentDir = join(WORKSPACE_ROOT, def.name);
  if (existsSync(join(agentDir, "SOUL.md"))) return;

  mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(agentDir, "skills"), { recursive: true });

  const soulContent = `---\nname: "${def.displayName}"\ndescription: "${def.description}"\nbuilt_in: true\n---\n\n${def.soul}`;
  writeFileSync(join(agentDir, "SOUL.md"), soulContent);

  const toolsList = def.tools.map((t) => `- **${t.toLowerCase()}** - ${t}`).join("\n");
  writeFileSync(join(agentDir, "TOOLS.md"), `# Tools\n\n${toolsList}\n`);

  writeFileSync(
    join(agentDir, "IDENTITY.md"),
    `# Identity\n\nYou are **${def.displayName}**. ${def.description}. You communicate clearly and professionally, focusing on delivering actionable outputs.\n`
  );

  writeFileSync(
    join(agentDir, "openclaw.json"),
    JSON.stringify(
      { llmProvider: "anthropic", llmModel: def.model, maxTurns: def.maxTurns, builtIn: true },
      null,
      2
    )
  );
}

function readBuiltInPrompt(filename: string): string {
  const promptPath = join(PROJECT_ROOT, "agent-server/src/prompts", filename);
  if (existsSync(promptPath)) return readFileSync(promptPath, "utf-8");
  // Compiled binaries / installed bundles have no source tree — use the
  // copy embedded at build time.
  return EMBEDDED_PROMPTS[filename] ?? "";
}

export { WORKSPACE_ROOT };
