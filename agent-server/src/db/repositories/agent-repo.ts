/**
 * Agent registry repository — the validated, versioned replacement for
 * filesystem "soul" agents. Every write validates the definition with Zod,
 * hashes it for provenance, and APPENDS an immutable revision; the `agents` row
 * only ever moves its `current_revision_id` pointer. Nothing here rewrites
 * history — rollback copies an old revision forward as a new one.
 *
 * Agent definitions are operational config and stay local (like deployments) —
 * no `recordChange()` sync calls in this file. Revisit if the cloud portal ever
 * needs to render agents.
 */

import { createHash, randomUUID } from "crypto";
import { z } from "zod";
import { getDb } from "../index.js";
import type { Agent, AgentRevision, AgentSummary } from "../../types.js";

/**
 * The single source of truth for tool names an agent may reference. Replaces
 * the markdown-bullet → regex parsing that souls used. Keep MCP tools as their
 * fully-qualified `mcp__server__tool` names.
 */
export const ToolName = z.enum([
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "Glob",
  "Grep",
  "Bash",
  "WebSearch",
  "WebFetch",
  "Task",
]);
export type ToolName = z.infer<typeof ToolName>;

/** A complete, validated agent definition — one revision's worth of behavior. */
export const AgentDefinition = z.object({
  displayName: z.string().min(1),
  description: z.string().default(""),
  systemPrompt: z.string().min(1),
  tools: z.array(ToolName).min(1),
  model: z.enum(["sonnet", "haiku", "opus"]),
  maxTurns: z.number().int().positive().max(200).default(30),
  llmProvider: z.literal("anthropic").default("anthropic"),
});
export type AgentDefinition = z.infer<typeof AgentDefinition>;

/** Names are stable identity: lowercase slug, never renamed (rename = new agent). */
const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;

export interface RevisionMeta {
  author?: string | null;
  reason?: string | null;
}

/**
 * sha256 of the canonical definition — a stable provenance measurement per
 * revision. Tool order is behaviorally irrelevant, so it is sorted before
 * hashing: reordering the allow-list does not mint a spurious new hash.
 */
function contentHash(def: AgentDefinition): string {
  const canonical = JSON.stringify([
    def.displayName,
    def.description,
    def.systemPrompt,
    [...def.tools].sort(),
    def.model,
    def.maxTurns,
    def.llmProvider,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

function definitionFromRow(r: AgentRevision): AgentDefinition {
  return AgentDefinition.parse({
    displayName: r.display_name,
    description: r.description,
    systemPrompt: r.system_prompt,
    tools: JSON.parse(r.tools),
    model: r.model,
    maxTurns: r.max_turns,
    llmProvider: r.llm_provider,
  });
}

function agentRow(name: string): Agent | undefined {
  return getDb()
    .prepare("SELECT * FROM agents WHERE name = ?")
    .get(name.trim().toLowerCase()) as Agent | undefined;
}

function currentRevisionRow(agent: Agent): AgentRevision | undefined {
  if (!agent.current_revision_id) return undefined;
  return getDb()
    .prepare("SELECT * FROM agent_revisions WHERE id = ?")
    .get(agent.current_revision_id) as AgentRevision | undefined;
}

/** Insert one revision row and return its id. Never updates an existing row. */
function insertRevision(
  agentId: string,
  revision: number,
  def: AgentDefinition,
  meta: RevisionMeta,
): string {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO agent_revisions
         (id, agent_id, revision, display_name, description, system_prompt,
          tools, model, max_turns, llm_provider, content_hash, change_reason, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      agentId,
      revision,
      def.displayName,
      def.description,
      def.systemPrompt,
      JSON.stringify(def.tools),
      def.model,
      def.maxTurns,
      def.llmProvider,
      contentHash(def),
      meta.reason ?? null,
      meta.author ?? null,
    );
  return id;
}

function nextRevisionNumber(agentId: string): number {
  const row = getDb()
    .prepare("SELECT MAX(revision) AS max FROM agent_revisions WHERE agent_id = ?")
    .get(agentId) as { max: number | null };
  return (row.max ?? 0) + 1;
}

/** Append a new revision from a full definition and repoint `current`. */
function appendRevision(agent: Agent, def: AgentDefinition, meta: RevisionMeta): Agent {
  const db = getDb();
  db.transaction(() => {
    const revId = insertRevision(agent.id, nextRevisionNumber(agent.id), def, meta);
    db.prepare(
      "UPDATE agents SET current_revision_id = ?, display_name = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(revId, def.displayName, agent.id);
  })();
  return agentRow(agent.name)!;
}

export interface CreateAgentOptions extends RevisionMeta {
  kind?: "user" | "built_in";
}

/** Create a new agent at revision 1. Throws on duplicate name or invalid definition. */
export function createAgent(
  name: string,
  definition: unknown,
  opts: CreateAgentOptions = {},
): Agent {
  const slug = name.trim().toLowerCase();
  if (!NAME_RE.test(slug)) {
    throw new Error(`Invalid agent name "${name}" (expected slug matching ${NAME_RE})`);
  }
  const def = AgentDefinition.parse(definition);
  const db = getDb();
  if (agentRow(slug)) throw new Error(`Agent "${slug}" already exists`);

  const agentId = randomUUID();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO agents (id, name, display_name, kind, status, created_by)
       VALUES (?, ?, ?, ?, 'active', ?)`,
    ).run(agentId, slug, def.displayName, opts.kind ?? "user", opts.author ?? null);

    const revId = insertRevision(agentId, 1, def, {
      author: opts.author ?? null,
      reason: opts.reason ?? "created",
    });
    db.prepare("UPDATE agents SET current_revision_id = ? WHERE id = ?").run(revId, agentId);
  })();

  return agentRow(slug)!;
}

/** Apply a partial change as a NEW revision. The merged result is re-validated. */
export function reviseAgent(
  name: string,
  patch: Partial<AgentDefinition>,
  meta: RevisionMeta = {},
): Agent {
  const agent = agentRow(name);
  if (!agent) throw new Error(`Unknown agent: ${name}`);
  const current = currentRevisionRow(agent);
  if (!current) throw new Error(`Agent "${name}" has no current revision`);

  const merged = AgentDefinition.parse({ ...definitionFromRow(current), ...patch });
  return appendRevision(agent, merged, meta);
}

/** Restore a past revision by copying its definition forward as a new revision. */
export function rollbackAgent(name: string, toRevision: number, meta: RevisionMeta = {}): Agent {
  const agent = agentRow(name);
  if (!agent) throw new Error(`Unknown agent: ${name}`);
  const target = getDb()
    .prepare("SELECT * FROM agent_revisions WHERE agent_id = ? AND revision = ?")
    .get(agent.id, toRevision) as AgentRevision | undefined;
  if (!target) throw new Error(`Agent "${name}" has no revision ${toRevision}`);

  return appendRevision(agent, definitionFromRow(target), {
    author: meta.author ?? null,
    reason: meta.reason ?? `rollback to revision ${toRevision}`,
  });
}

/** Archive (soft-delete) an agent. History is retained; it stops being runnable. */
export function archiveAgent(name: string): void {
  const agent = agentRow(name);
  if (!agent) throw new Error(`Unknown agent: ${name}`);
  getDb()
    .prepare("UPDATE agents SET status = 'archived', updated_at = datetime('now') WHERE id = ?")
    .run(agent.id);
}

/** The current, validated definition of an ACTIVE agent — what the runner consumes. */
export function getAgentDefinition(name: string): AgentDefinition | null {
  const agent = agentRow(name);
  if (!agent || agent.status !== "active") return null;
  const current = currentRevisionRow(agent);
  if (!current) return null;
  return definitionFromRow(current);
}

export function getAgent(name: string): Agent | null {
  return agentRow(name) ?? null;
}

/** Full audit trail for an agent, newest revision first. */
export function listRevisions(name: string): AgentRevision[] {
  const agent = agentRow(name);
  if (!agent) return [];
  return getDb()
    .prepare("SELECT * FROM agent_revisions WHERE agent_id = ? ORDER BY revision DESC")
    .all(agent.id) as AgentRevision[];
}

/** Active agents with their current revision summarized, for listing UIs. */
export function listAgents(): AgentSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT a.name, a.display_name, a.kind, a.status, a.updated_at,
              r.revision, r.description, r.tools, r.model
         FROM agents a
         JOIN agent_revisions r ON r.id = a.current_revision_id
        WHERE a.status = 'active'
        ORDER BY a.name`,
    )
    .all() as Array<
    Pick<Agent, "name" | "display_name" | "kind" | "status" | "updated_at"> &
      Pick<AgentRevision, "revision" | "description" | "tools" | "model">
  >;

  return rows.map((r) => ({
    name: r.name,
    display_name: r.display_name,
    kind: r.kind,
    status: r.status,
    model: r.model,
    revision: r.revision,
    description: r.description,
    tool_count: (JSON.parse(r.tools) as unknown[]).length,
    updated_at: r.updated_at,
  }));
}
