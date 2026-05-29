-- Cloudflare Workers-for-Platforms deployments for tenant apps generated via
-- Claude Code Web/IDE. Each row tracks one upload to a WfP dispatch namespace.
-- Bindings (D1, R2, KV) are reattached across redeploys via deployment_bindings.
-- NOT synced to cloud — operational state lives locally only.

CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  source_type TEXT NOT NULL CHECK (source_type IN ('git','tarball')),
  source_ref TEXT NOT NULL,                       -- repo URL + commit SHA, or tarball hash
  script_name TEXT NOT NULL,                      -- WfP script in the dispatch namespace
  dispatch_namespace TEXT NOT NULL,
  custom_hostname TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','building','uploading','live','failed','torn_down')),
  failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  promoted_at TEXT,
  torn_down_at TEXT
);

-- Per-project binding registry. resource_id is the stable Cloudflare resource UUID
-- (D1 database id, R2 bucket name, KV namespace id) — reused across redeploys so a
-- project's D1 contents survive a new deployment.
CREATE TABLE IF NOT EXISTS deployment_bindings (
  deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  binding_name TEXT NOT NULL,                     -- env var name in the Worker
  binding_type TEXT NOT NULL CHECK (binding_type IN ('d1','r2','kv')),
  resource_id TEXT NOT NULL,
  PRIMARY KEY (deployment_id, binding_name)
);

CREATE TABLE IF NOT EXISTS deployment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  level TEXT NOT NULL CHECK (level IN ('info','warn','error')),
  message TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deployments_project ON deployments(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deployment_events_dep ON deployment_events(deployment_id, ts);
CREATE INDEX IF NOT EXISTS idx_deployment_bindings_dep ON deployment_bindings(deployment_id);
