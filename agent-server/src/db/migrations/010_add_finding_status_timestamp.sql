-- When a finding's status last changed (resolved / accepted-risk / false-positive).
-- Used by the security-posture view to compute time-to-remediate for findings a
-- person closed, alongside scan-based resolution (fingerprint disappearing).
ALTER TABLE scan_findings ADD COLUMN status_changed_at TEXT;
