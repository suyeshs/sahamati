/**
 * Deterministic, code-defined tool-permission gate.
 *
 * Runs as a Claude Agent SDK `PreToolUse` hook — the one seam that fires before
 * every tool call (sub-agent calls included) and that `allowedTools` /
 * `permissionMode` cannot bypass. This is where Hard Rule #1 lives: model output
 * reaches a real tool only after a deterministic allow/deny check that lives in
 * version-controlled code, not in a runtime-editable prompt.
 *
 * Two layers of policy:
 *   1. Tool-level, deny-by-default — a tool the agent never declared is refused.
 *      This duplicates the SDK's `allowedTools` allowlist on purpose: the gate is
 *      unbypassable and every decision is auditable, which `allowedTools` is not.
 *   2. Argument-level — protected-path writes and destructive / secret-exfil
 *      shell commands, which `allowedTools` cannot express.
 *
 * The Bash rules are a high-signal *denylist*, i.e. defense-in-depth, not a
 * sandbox. They stop the obvious ways to touch secrets or destroy state; they do
 * not claim to enumerate every dangerous command. Tightening toward an allowlist
 * is a deliberate later step.
 */

import { resolve, relative, basename, isAbsolute } from "path";

// Derive the hook types from the SDK's query options rather than importing named
// type exports — same idiom as `SdkMcpServers` in orchestrator.ts, and it keeps
// this file correct across SDK minor versions.
type QueryFn = typeof import("@anthropic-ai/claude-agent-sdk").query;
type QueryOptions = NonNullable<Parameters<QueryFn>[0]["options"]>;
export type HooksConfig = NonNullable<QueryOptions["hooks"]>;
type HookMatcher = NonNullable<HooksConfig["PreToolUse"]>[number];
type HookFn = HookMatcher["hooks"][number];

export type GateDecision =
  | { decision: "allow" }
  | { decision: "deny"; reason: string };

export interface EvaluateArgs {
  /** Agent whose allow-set governs this call (for audit + deny-by-default). */
  agentName: string;
  /** The tools this agent declared — the tool-level allow-set. */
  allowedTools: readonly string[];
  /** Absolute project root; file-write targets are resolved against it. */
  projectRoot: string;
  toolName: string;
  toolInput: unknown;
  /** Sub-agent id, when the call originates inside a delegated agent. */
  agentId?: string;
  /** When set, `git push` is only allowed to branches with one of these prefixes. */
  branchPolicy?: { allowedPrefixes: readonly string[] };
  /** Deny package-manager install/add commands (dependency changes go through typed tools). */
  denyInstalls?: boolean;
  /**
   * Confine Read/Glob/Grep (and other read tools) to `projectRoot`, and refuse
   * reads of secret files by basename. Defender agents run with this on so a
   * checkout is the only thing they can look at.
   */
  confineReads?: boolean;
}

const READ_TOOLS = new Set(["Read", "Glob", "Grep", "NotebookRead", "LS"]);

/** Why reading `targetPath` is refused under read confinement, or null. */
function confinedReadReason(targetPath: string, projectRoot: string): string | null {
  const abs = isAbsolute(targetPath) ? targetPath : resolve(projectRoot, targetPath);
  const rel = relative(projectRoot, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return `reads outside the checkout (${abs}) are not permitted for this agent`;
  }
  const nameReason = protectedBasename(basename(abs));
  if (nameReason) return `reads of ${nameReason} are not permitted`;
  return null;
}

/** Basenames whose write must always be refused (secrets / key material). */
function protectedBasename(name: string): string | null {
  if (/^\.env(\..+)?$/.test(name)) return ".env files hold secrets";
  if (name === ".db-key" || name.endsWith(".db-key")) return "the DB encryption key";
  return null;
}

/** Why writing `filePath` is refused, or null if it is allowed. */
function protectedPathReason(filePath: string, projectRoot: string): string | null {
  const abs = isAbsolute(filePath) ? filePath : resolve(projectRoot, filePath);
  const rel = relative(projectRoot, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    return `writes outside the project root (${abs}) are not permitted`;
  }
  // `data/` holds the encrypted SQLite DB and its key — never a write target.
  if (rel.split(/[\\/]/).includes("data")) {
    return "writes into data/ (encrypted DB + key) are not permitted";
  }
  const nameReason = protectedBasename(basename(abs));
  if (nameReason) return `writes to ${nameReason} are not permitted`;
  return null;
}

/** High-signal destructive / secret-exfil shell patterns. Extend deliberately. */
const DANGEROUS_COMMAND_RULES: ReadonlyArray<{ re: RegExp; reason: string }> = [
  { re: /\brm\s+-[a-z]*(rf|fr)\b/i, reason: "recursive force-delete (rm -rf)" },
  { re: /\bgit\s+push\b[^\n]*(--force\b|\s-f\b)/i, reason: "force-push" },
  { re: /\bdrop\s+(table|database)\b/i, reason: "SQL DROP" },
  { re: /\bSAHAMATI_DB_KEY\b/, reason: "references the DB encryption key" },
  { re: /\.db-key\b/i, reason: "touches the DB encryption key file" },
  { re: /(^|[\s;|&(])(cat|less|more|head|tail|xxd|od|base64|strings)\s+[^\n;|&]*\.env\b/i, reason: "reads a .env secrets file" },
  { re: /(>|>>)\s*[^\n;|&]*\.env\b/i, reason: "writes a .env secrets file" },
  { re: /\bcurl\b[^\n]*\|\s*(sh|bash|zsh)\b/i, reason: "pipes remote content into a shell" },
  // Remediation agents may only ever land changes through a reviewed PR.
  { re: /\bgit\s+push\b[^\n]*\b(main|master|develop)\b/i, reason: "pushes to a protected branch" },
  { re: /\bgh\s+pr\s+merge\b/i, reason: "merges a pull request (humans merge)" },
  { re: /\bgh\s+repo\s+delete\b/i, reason: "deletes a repository" },
  { re: /\bgit\s+branch\s+-D\b/i, reason: "force-deletes a branch" },
  { re: /\bgit\s+reset\s+--hard\b/i, reason: "discards working-tree changes" },
  { re: /\bgit\s+clean\s+-[a-z]*f/i, reason: "force-cleans the working tree" },
];

/** Package-manager install/add commands, denied when `denyInstalls` is set. */
const INSTALL_COMMAND_RE = /(^|[\s;|&(])(npm|bun|pnpm|yarn|pip|pip3|uv|cargo)\s+(install|add|i)\b|(^|[\s;|&(])npx\s/i;

/** Branch token of a `git push`, when one is spelled out (`origin branch` or `origin src:dst`). */
function pushedBranch(command: string): string | null {
  const m = command.match(/\bgit\s+push\b([^\n;|&]*)/i);
  if (!m) return null;
  const tokens = m[1].trim().split(/\s+/).filter((t) => t && !t.startsWith("-"));
  if (tokens.length < 2) return null; // `git push` with no refspec: branch unknown
  const refspec = tokens[1];
  const dst = refspec.includes(":") ? refspec.split(":")[1] : refspec;
  return dst.replace(/^refs\/heads\//, "");
}

function dangerousCommandReason(command: string): string | null {
  for (const rule of DANGEROUS_COMMAND_RULES) {
    if (rule.re.test(command)) return rule.reason;
  }
  return null;
}

function stringField(input: unknown, key: string): string | null {
  if (input && typeof input === "object" && key in input) {
    const v = (input as Record<string, unknown>)[key];
    if (typeof v === "string") return v;
  }
  return null;
}

/**
 * The pure policy decision for one tool call. Exported so it can be unit-tested
 * without spinning up the SDK.
 */
export function evaluateToolCall(a: EvaluateArgs): GateDecision {
  // 1. Tool-level, deny-by-default.
  if (!a.allowedTools.includes(a.toolName)) {
    return { decision: "deny", reason: `tool "${a.toolName}" is not in this agent's allow-set` };
  }

  // 2. Argument-level rules for the tools that can touch the filesystem or shell.
  if (a.confineReads && READ_TOOLS.has(a.toolName)) {
    const target = stringField(a.toolInput, "file_path") ?? stringField(a.toolInput, "path") ?? stringField(a.toolInput, "notebook_path");
    if (target) {
      const reason = confinedReadReason(target, a.projectRoot);
      if (reason) return { decision: "deny", reason };
    }
  }
  if (a.toolName === "Write" || a.toolName === "Edit" || a.toolName === "MultiEdit") {
    const filePath = stringField(a.toolInput, "file_path") ?? stringField(a.toolInput, "path");
    if (filePath) {
      const reason = protectedPathReason(filePath, a.projectRoot);
      if (reason) return { decision: "deny", reason };
    }
  } else if (a.toolName === "Bash") {
    const command = stringField(a.toolInput, "command");
    if (command) {
      const reason = dangerousCommandReason(command);
      if (reason) return { decision: "deny", reason };
      if (a.denyInstalls && INSTALL_COMMAND_RE.test(command)) {
        return { decision: "deny", reason: "package installs must go through the typed defender tools" };
      }
      if (a.branchPolicy && /\bgit\s+push\b/i.test(command)) {
        const branch = pushedBranch(command);
        const ok = branch !== null && a.branchPolicy.allowedPrefixes.some((p) => branch.startsWith(p));
        if (!ok) {
          return {
            decision: "deny",
            reason: `git push is only permitted to branches prefixed ${a.branchPolicy.allowedPrefixes.join(", ")}`,
          };
        }
      }
    }
  }

  return { decision: "allow" };
}

export interface GateAuditEvent {
  agent: string;
  agentId?: string;
  tool: string;
  decision: "allow" | "deny";
  reason?: string;
  /** Redacted operational target — a file path, or a Bash command's first token. Never full args. */
  target?: string;
}

/**
 * Redacted target for the audit line. Full args are never logged — a Bash
 * command or file content can carry secrets or regulated data (org rule §2).
 */
function auditTarget(toolName: string, toolInput: unknown): string | undefined {
  if (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit" || READ_TOOLS.has(toolName)) {
    return stringField(toolInput, "file_path") ?? stringField(toolInput, "path") ?? undefined;
  }
  if (toolName === "Bash") {
    const command = stringField(toolInput, "command");
    return command ? command.trim().split(/\s+/)[0] : undefined;
  }
  return undefined;
}

function defaultAudit(ev: GateAuditEvent): void {
  const who = ev.agentId ? `${ev.agent}/${ev.agentId}` : ev.agent;
  const target = ev.target ? ` target=${ev.target}` : "";
  if (ev.decision === "deny") {
    console.warn(`[tool-gate] DENY agent=${who} tool=${ev.tool}${target} — ${ev.reason}`);
  } else if (process.env.SAHAMATI_TOOL_AUDIT_VERBOSE === "1") {
    console.log(`[tool-gate] allow agent=${who} tool=${ev.tool}${target}`);
  }
}

export interface ToolGateOptions {
  agentName: string;
  allowedTools: readonly string[];
  projectRoot: string;
  /** Override the audit sink (default: redacted console). */
  onDecision?: (ev: GateAuditEvent) => void;
  branchPolicy?: EvaluateArgs["branchPolicy"];
  denyInstalls?: boolean;
  confineReads?: boolean;
}

/**
 * Build the `hooks` fragment to spread into the SDK `query` options. Every
 * PreToolUse call is evaluated and audited; only a deny returns a decision, so
 * allowed calls fall through to the SDK's normal permission precedence.
 */
export function buildToolGateHooks(opts: ToolGateOptions): HooksConfig {
  const audit = opts.onDecision ?? defaultAudit;

  const hook: HookFn = async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};

    const result = evaluateToolCall({
      agentName: opts.agentName,
      allowedTools: opts.allowedTools,
      projectRoot: opts.projectRoot,
      toolName: input.tool_name,
      toolInput: input.tool_input,
      agentId: input.agent_id,
      branchPolicy: opts.branchPolicy,
      denyInstalls: opts.denyInstalls,
      confineReads: opts.confineReads,
    });

    audit({
      agent: opts.agentName,
      agentId: input.agent_id,
      tool: input.tool_name,
      decision: result.decision,
      reason: result.decision === "deny" ? result.reason : undefined,
      target: auditTarget(input.tool_name, input.tool_input),
    });

    if (result.decision === "deny") {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: result.reason,
        },
      };
    }
    return {};
  };

  return { PreToolUse: [{ hooks: [hook] }] };
}
