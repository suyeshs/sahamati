-- Package inventory per scan, so the CVE watch can re-check a target against
-- the advisory feed without cloning it again.
CREATE TABLE IF NOT EXISTS scan_packages (
  scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  lockfile_path TEXT NOT NULL,
  manifest_path TEXT NOT NULL,
  ecosystem TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  is_direct INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scan_id, lockfile_path, name, version)
);

-- Newly published advisories that affect an inventoried package and were not
-- known at the time of the last scan. Shown as notifications until acknowledged
-- or superseded by a rescan that records the finding.
CREATE TABLE IF NOT EXISTS defender_alerts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES scan_targets(id) ON DELETE CASCADE,
  scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  advisory_id TEXT NOT NULL,
  aliases TEXT,                       -- JSON array
  severity TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low','info')),
  ecosystem TEXT NOT NULL,
  package TEXT NOT NULL,
  installed_version TEXT NOT NULL,
  fixed_version TEXT,
  manifest_path TEXT NOT NULL,
  summary TEXT NOT NULL,
  published_at TEXT,
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  acknowledged_at TEXT,
  acknowledged_by TEXT REFERENCES users(id),
  UNIQUE (target_id, advisory_id, package, installed_version)
);

CREATE INDEX IF NOT EXISTS idx_alerts_open ON defender_alerts(acknowledged_at, severity);
CREATE INDEX IF NOT EXISTS idx_alerts_project ON defender_alerts(project_id);

-- Small key/value state for the watch (last run time, last error).
CREATE TABLE IF NOT EXISTS defender_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
