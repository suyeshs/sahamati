-- Validated, versioned agent registry — replaces filesystem "soul" agents
-- (openclaw-agents/*/SOUL.md, TOOLS.md, …). An agent's IDENTITY is one `agents`
-- row; its BEHAVIOR is an append-only chain of `agent_revisions`. Every runtime
-- edit inserts a new revision, so "what was this agent instructed to do on date
-- X, and who changed it" is answerable — the auditability the regulated AA
-- context requires and that mutable markdown folders cannot provide.
--
-- The code-defined assessors (security/owasp/vapt) are deliberately NOT stored
-- here; they stay in version-controlled TS. This registry is for the editable
-- agents that souls used to hold.

CREATE TABLE IF NOT EXISTS agents (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL UNIQUE,          -- stable slug, e.g. "evernote"
  display_name        TEXT NOT NULL,                 -- denormalized cache of the current revision
  kind                TEXT NOT NULL DEFAULT 'user'
                        CHECK (kind IN ('user','built_in')),
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','archived')),
  current_revision_id TEXT REFERENCES agent_revisions(id),  -- the live version
  created_by          TEXT REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One immutable snapshot of an agent's complete definition. Never UPDATEd or
-- DELETEd on its own (only cascade-removed when the whole agent is deleted).
CREATE TABLE IF NOT EXISTS agent_revisions (
  id            TEXT PRIMARY KEY,
  agent_id      TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  revision      INTEGER NOT NULL,                    -- 1,2,3… monotonic per agent
  display_name  TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL,                       -- replaces SOUL + IDENTITY concat
  tools         TEXT NOT NULL DEFAULT '[]',          -- JSON array; validated vs ToolName at the boundary
  model         TEXT NOT NULL DEFAULT 'sonnet'
                  CHECK (model IN ('sonnet','haiku','opus')),
  max_turns     INTEGER NOT NULL DEFAULT 30
                  CHECK (max_turns > 0 AND max_turns <= 200),
  llm_provider  TEXT NOT NULL DEFAULT 'anthropic',
  content_hash  TEXT NOT NULL,                       -- sha256 of the canonical definition
  change_reason TEXT,                                -- audit note for this edit
  created_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (agent_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_agents_status         ON agents(status, name);
CREATE INDEX IF NOT EXISTS idx_agent_revisions_agent ON agent_revisions(agent_id, revision DESC);

-- Defense-in-depth: revisions are append-only. Edits go forward as new rows;
-- the repository never rewrites them, and neither can a stray query.
CREATE TRIGGER IF NOT EXISTS agent_revisions_no_update
BEFORE UPDATE ON agent_revisions
BEGIN
  SELECT RAISE(ABORT, 'agent_revisions is append-only');
END;
