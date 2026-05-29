-- Bearer-token credentials for authenticated scans. Envelope-encrypted with
-- SAHAMATI_CRED_KEY (a separate secret from the DB key). NEVER synced to cloud.
CREATE TABLE IF NOT EXISTS scan_credentials (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('bearer')),
  ciphertext BLOB NOT NULL,
  nonce BLOB NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  rotated_at TEXT
);

-- Authorized scan targets. Targets are only scannable once approved_at IS NOT NULL.
-- environment='prod' is gated behind SAHAMATI_ALLOW_PROD_SCANS=true at runtime.
CREATE TABLE IF NOT EXISTS scan_targets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  base_url TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('dev','staging','uat','prod')),
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  approval_reason TEXT,
  scan_profile TEXT NOT NULL DEFAULT 'safe-default',
  schedule_cron TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  auth_credential_id TEXT REFERENCES scan_credentials(id) ON DELETE SET NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Individual scan runs.
CREATE TABLE IF NOT EXISTS scans (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES scan_targets(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','aborted')),
  trigger TEXT NOT NULL CHECK (trigger IN ('manual','scheduled')),
  triggered_by TEXT REFERENCES users(id),
  started_at TEXT,
  completed_at TEXT,
  request_count INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  report_path TEXT,
  error TEXT
);

-- Per-finding rows. fingerprint is a stable hash over (category, location, signature)
-- so regressions can be diffed without text comparison.
CREATE TABLE IF NOT EXISTS scan_findings (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low','info')),
  category TEXT NOT NULL,
  cwe TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  location TEXT NOT NULL,
  evidence TEXT,
  remediation TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','accepted-risk','false-positive')),
  first_seen_scan_id TEXT REFERENCES scans(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scan_targets_project ON scan_targets(project_id);
CREATE INDEX IF NOT EXISTS idx_scans_target ON scans(target_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_findings_scan ON scan_findings(scan_id);
CREATE INDEX IF NOT EXISTS idx_findings_fingerprint ON scan_findings(fingerprint);
CREATE INDEX IF NOT EXISTS idx_credentials_project ON scan_credentials(project_id);
