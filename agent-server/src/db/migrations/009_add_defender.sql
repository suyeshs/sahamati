-- Dependency-CVE findings produced by the defender pipeline reuse scan_targets /
-- scans / scan_findings (migration 006) with scan_profile = 'dependency-cve'.
-- For those targets base_url holds the repository URL (or a file:// path for
-- local scan-only targets) and environment is always 'dev'.

ALTER TABLE scan_findings ADD COLUMN ecosystem TEXT;
ALTER TABLE scan_findings ADD COLUMN package TEXT;
ALTER TABLE scan_findings ADD COLUMN installed_version TEXT;
ALTER TABLE scan_findings ADD COLUMN fixed_version TEXT;
ALTER TABLE scan_findings ADD COLUMN advisory_ids TEXT;        -- JSON array of ids
ALTER TABLE scan_findings ADD COLUMN manifest_path TEXT;
ALTER TABLE scan_findings ADD COLUMN is_direct INTEGER;
ALTER TABLE scan_findings ADD COLUMN priority TEXT CHECK (priority IS NULL OR priority IN ('p0','p1','p2','p3'));
ALTER TABLE scan_findings ADD COLUMN reachability TEXT CHECK (reachability IS NULL OR reachability IN ('reachable','unreachable','unknown'));
ALTER TABLE scan_findings ADD COLUMN triage_note TEXT;
ALTER TABLE scan_findings ADD COLUMN remediation_pr_url TEXT;

CREATE INDEX IF NOT EXISTS idx_findings_package ON scan_findings(ecosystem, package);

-- A proposed version bump for one finding. The patch agent proposes; the typed
-- tool validates and records; status advances only through code.
CREATE TABLE IF NOT EXISTS defender_proposals (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  finding_id TEXT NOT NULL REFERENCES scan_findings(id) ON DELETE CASCADE,
  ecosystem TEXT NOT NULL,
  package TEXT NOT NULL,
  manifest_path TEXT NOT NULL,
  lockfile_path TEXT NOT NULL,
  from_version TEXT NOT NULL,
  to_version TEXT NOT NULL,
  strategy TEXT NOT NULL CHECK (strategy IN ('direct','override','cargo-precise','uv-constraint')),
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','applied','installed','tested','test-failed','pr-opened','failed')),
  test_summary TEXT,
  error TEXT,
  pr_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_proposals_scan ON defender_proposals(scan_id);
CREATE INDEX IF NOT EXISTS idx_proposals_finding ON defender_proposals(finding_id);

-- Response cache for the public OSV API so repeated scans do not re-query
-- unchanged packages. Never synced; contains only public advisory data.
CREATE TABLE IF NOT EXISTS osv_cache (
  key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
