// Defender-specific queries layered over scan-repo. Targets, scans and findings
// live in the migration-006 tables; proposals and the OSV cache are new in 009.

import { randomUUID } from "crypto";
import { getDb } from "../index.js";
import { recordChange } from "../../sync/sync-engine.js";
import type { Finding, ScanTarget, Scan } from "./scan-repo-types.js";

export const DEPENDENCY_PROFILE = "dependency-cve";

export type ProposalStrategy = "direct" | "override" | "cargo-precise" | "uv-constraint";
export type ProposalStatus = "proposed" | "applied" | "installed" | "tested" | "test-failed" | "pr-opened" | "failed";

export interface Proposal {
  id: string;
  scan_id: string;
  finding_id: string;
  ecosystem: string;
  package: string;
  manifest_path: string;
  lockfile_path: string;
  from_version: string;
  to_version: string;
  strategy: ProposalStrategy;
  status: ProposalStatus;
  test_summary: string | null;
  error: string | null;
  pr_url: string | null;
  created_at: string;
  updated_at: string;
}

// --- Targets ----------------------------------------------------------------

export function createDependencyTarget(params: {
  projectId: string;
  label: string;
  repoUrl: string;
  scheduleCron?: string;
  createdBy: string;
}): ScanTarget {
  const id = randomUUID();
  const db = getDb();
  db.prepare(
    `INSERT INTO scan_targets (id, project_id, label, base_url, environment, scan_profile, schedule_cron, created_by)
     VALUES (?, ?, ?, ?, 'dev', ?, ?, ?)`,
  ).run(id, params.projectId, params.label, params.repoUrl, DEPENDENCY_PROFILE, params.scheduleCron ?? null, params.createdBy);
  const row = db.prepare("SELECT * FROM scan_targets WHERE id = ?").get(id) as ScanTarget;
  recordChange("scan_targets", id, "INSERT", row as unknown as Record<string, unknown>);
  return row;
}

export function listDependencyTargets(projectId?: string): ScanTarget[] {
  const db = getDb();
  if (projectId) {
    return db
      .prepare("SELECT * FROM scan_targets WHERE scan_profile = ? AND project_id = ? ORDER BY created_at DESC")
      .all(DEPENDENCY_PROFILE, projectId) as ScanTarget[];
  }
  return db.prepare("SELECT * FROM scan_targets WHERE scan_profile = ? ORDER BY created_at DESC").all(DEPENDENCY_PROFILE) as ScanTarget[];
}

export function listScheduledDependencyTargets(): ScanTarget[] {
  return getDb()
    .prepare(
      `SELECT * FROM scan_targets
       WHERE scan_profile = ? AND active = 1 AND schedule_cron IS NOT NULL AND approved_at IS NOT NULL`,
    )
    .all(DEPENDENCY_PROFILE) as ScanTarget[];
}

export function updateTargetSchedule(targetId: string, scheduleCron: string | null): ScanTarget | null {
  const db = getDb();
  const r = db
    .prepare("UPDATE scan_targets SET schedule_cron = ?, updated_at = datetime('now') WHERE id = ? AND scan_profile = ?")
    .run(scheduleCron, targetId, DEPENDENCY_PROFILE);
  if (r.changes === 0) return null;
  const row = db.prepare("SELECT * FROM scan_targets WHERE id = ?").get(targetId) as ScanTarget;
  recordChange("scan_targets", targetId, "UPDATE", row as unknown as Record<string, unknown>);
  return row;
}

/** True when a scan for this target started within the current wall-clock minute. */
export function scanStartedThisMinute(targetId: string, now: Date): boolean {
  const minute = now.toISOString().slice(0, 16).replace("T", " "); // "YYYY-MM-DD HH:MM"
  const row = getDb()
    .prepare("SELECT 1 AS hit FROM scans WHERE target_id = ? AND started_at LIKE ? LIMIT 1")
    .get(targetId, `${minute}%`) as { hit: number } | undefined;
  return Boolean(row);
}

// --- Findings ---------------------------------------------------------------

export interface FindingWithProposal extends Finding {
  proposal_id: string | null;
  proposal_status: ProposalStatus | null;
  proposal_pr_url: string | null;
}

/** Findings of the latest completed scan for a target, newest scan only. */
export function listLatestFindings(targetId: string, status?: Finding["status"]): { scan: Scan | null; findings: FindingWithProposal[] } {
  const db = getDb();
  const scan = (db
    .prepare("SELECT * FROM scans WHERE target_id = ? AND status = 'completed' ORDER BY started_at DESC, rowid DESC LIMIT 1")
    .get(targetId) as Scan | undefined) ?? null;
  if (!scan) return { scan: null, findings: [] };
  const sql = `
    SELECT f.*, p.id AS proposal_id, p.status AS proposal_status, p.pr_url AS proposal_pr_url
    FROM scan_findings f
    LEFT JOIN defender_proposals p ON p.finding_id = f.id
    WHERE f.scan_id = ? ${status ? "AND f.status = ?" : ""}
    ORDER BY CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
             f.package ASC`;
  const rows = (status ? db.prepare(sql).all(scan.id, status) : db.prepare(sql).all(scan.id)) as FindingWithProposal[];
  return { scan, findings: rows };
}

export function getFinding(id: string): Finding | null {
  return (getDb().prepare("SELECT * FROM scan_findings WHERE id = ?").get(id) as Finding | undefined) ?? null;
}

export function annotateFinding(params: {
  findingId: string;
  priority: "p0" | "p1" | "p2" | "p3";
  reachability: "reachable" | "unreachable" | "unknown";
  note: string;
}): Finding | null {
  const db = getDb();
  const r = db
    .prepare("UPDATE scan_findings SET priority = ?, reachability = ?, triage_note = ? WHERE id = ?")
    .run(params.priority, params.reachability, params.note.slice(0, 1000), params.findingId);
  if (r.changes === 0) return null;
  const row = getFinding(params.findingId)!;
  recordChange("scan_findings", params.findingId, "UPDATE", row as unknown as Record<string, unknown>);
  return row;
}

export function setFindingPrUrl(findingId: string, prUrl: string): void {
  const db = getDb();
  db.prepare("UPDATE scan_findings SET remediation_pr_url = ? WHERE id = ?").run(prUrl, findingId);
  const row = getFinding(findingId);
  if (row) recordChange("scan_findings", findingId, "UPDATE", row as unknown as Record<string, unknown>);
}

/**
 * Carry triage annotations forward: a finding with the same fingerprint in an
 * earlier scan keeps its priority/reachability/note and any accepted-risk or
 * false-positive status, so a nightly re-scan does not reset human decisions.
 */
export function inheritTriage(scanId: string): number {
  const db = getDb();
  const r = db
    .prepare(
      `UPDATE scan_findings SET
         priority = (SELECT p.priority FROM scan_findings p JOIN scans s ON s.id = p.scan_id
                     WHERE p.fingerprint = scan_findings.fingerprint AND p.scan_id != ?
                       AND s.target_id = (SELECT target_id FROM scans WHERE id = ?)
                     ORDER BY s.started_at DESC LIMIT 1),
         reachability = (SELECT p.reachability FROM scan_findings p JOIN scans s ON s.id = p.scan_id
                     WHERE p.fingerprint = scan_findings.fingerprint AND p.scan_id != ?
                       AND s.target_id = (SELECT target_id FROM scans WHERE id = ?)
                     ORDER BY s.started_at DESC LIMIT 1),
         triage_note = (SELECT p.triage_note FROM scan_findings p JOIN scans s ON s.id = p.scan_id
                     WHERE p.fingerprint = scan_findings.fingerprint AND p.scan_id != ?
                       AND s.target_id = (SELECT target_id FROM scans WHERE id = ?)
                     ORDER BY s.started_at DESC LIMIT 1),
         status = COALESCE((SELECT p.status FROM scan_findings p JOIN scans s ON s.id = p.scan_id
                     WHERE p.fingerprint = scan_findings.fingerprint AND p.scan_id != ?
                       AND s.target_id = (SELECT target_id FROM scans WHERE id = ?)
                       AND p.status IN ('accepted-risk','false-positive')
                     ORDER BY s.started_at DESC LIMIT 1), status),
         status_changed_at = (SELECT p.status_changed_at FROM scan_findings p JOIN scans s ON s.id = p.scan_id
                     WHERE p.fingerprint = scan_findings.fingerprint AND p.scan_id != ?
                       AND s.target_id = (SELECT target_id FROM scans WHERE id = ?)
                       AND p.status IN ('accepted-risk','false-positive')
                     ORDER BY s.started_at DESC LIMIT 1)
       WHERE scan_id = ?`,
    )
    .run(scanId, scanId, scanId, scanId, scanId, scanId, scanId, scanId, scanId, scanId, scanId);
  return r.changes;
}

// --- Proposals --------------------------------------------------------------

export function createProposal(params: {
  scanId: string;
  findingId: string;
  ecosystem: string;
  package: string;
  manifestPath: string;
  lockfilePath: string;
  fromVersion: string;
  toVersion: string;
  strategy: ProposalStrategy;
}): Proposal {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO defender_proposals
       (id, scan_id, finding_id, ecosystem, package, manifest_path, lockfile_path, from_version, to_version, strategy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, params.scanId, params.findingId, params.ecosystem, params.package, params.manifestPath, params.lockfilePath, params.fromVersion, params.toVersion, params.strategy);
  return getProposal(id)!;
}

export function getProposal(id: string): Proposal | null {
  return (getDb().prepare("SELECT * FROM defender_proposals WHERE id = ?").get(id) as Proposal | undefined) ?? null;
}

export function listProposals(scanId: string): Proposal[] {
  return getDb().prepare("SELECT * FROM defender_proposals WHERE scan_id = ? ORDER BY created_at ASC").all(scanId) as Proposal[];
}

export function updateProposal(
  id: string,
  patch: { status: ProposalStatus; testSummary?: string; error?: string; prUrl?: string; toVersion?: string },
): Proposal | null {
  const db = getDb();
  db.prepare(
    `UPDATE defender_proposals
     SET status = ?, test_summary = COALESCE(?, test_summary), error = ?, pr_url = COALESCE(?, pr_url),
         to_version = COALESCE(?, to_version), updated_at = datetime('now')
     WHERE id = ?`,
  ).run(patch.status, patch.testSummary ?? null, patch.error ?? null, patch.prUrl ?? null, patch.toVersion ?? null, id);
  return getProposal(id);
}

// --- OSV cache --------------------------------------------------------------

export function osvCacheGet(key: string): string | null {
  const row = getDb().prepare("SELECT payload FROM osv_cache WHERE key = ?").get(key) as { payload: string } | undefined;
  return row?.payload ?? null;
}

export function osvCachePut(key: string, payload: string): void {
  getDb()
    .prepare("INSERT INTO osv_cache (key, payload, fetched_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at")
    .run(key, payload);
}


// --- Posture input (cross-project metrics) ---------------------------------

export interface PostureScanRow {
  id: string;
  target_id: string;
  completed_at: string | null;
  started_at: string | null;
  summary: string | null;
}

export interface PostureFindingRow {
  id: string;
  scan_id: string;
  fingerprint: string;
  severity: Finding["severity"];
  status: Finding["status"];
  priority: Finding["priority"];
  reachability: Finding["reachability"];
  remediation_pr_url: string | null;
  status_changed_at: string | null;
  is_direct: number | null;
  package: string | null;
}

export interface PostureProposalRow {
  scan_id: string;
  status: ProposalStatus;
  pr_url: string | null;
}

/** Rows for the posture computation: targets, their last N completed scans, and those scans' findings. */
export function loadPostureRows(projectIds: string[], scansPerTarget = 12): {
  targets: ScanTarget[];
  scans: PostureScanRow[];
  findings: PostureFindingRow[];
  proposals: PostureProposalRow[];
} {
  if (projectIds.length === 0) return { targets: [], scans: [], findings: [], proposals: [] };
  const db = getDb();
  const ph = projectIds.map(() => "?").join(",");
  const targets = db
    .prepare(`SELECT * FROM scan_targets WHERE scan_profile = ? AND project_id IN (${ph}) ORDER BY created_at ASC`)
    .all(DEPENDENCY_PROFILE, ...projectIds) as ScanTarget[];
  const scans: PostureScanRow[] = [];
  const scanStmt = db.prepare(
    `SELECT id, target_id, completed_at, started_at, summary FROM scans
     WHERE target_id = ? AND status = 'completed' ORDER BY started_at DESC, rowid DESC LIMIT ?`,
  );
  for (const t of targets) scans.push(...(scanStmt.all(t.id, scansPerTarget) as PostureScanRow[]));
  if (scans.length === 0) return { targets, scans, findings: [], proposals: [] };
  const sph = scans.map(() => "?").join(",");
  const scanIds = scans.map((s) => s.id);
  const findings = db
    .prepare(
      `SELECT id, scan_id, fingerprint, severity, status, priority, reachability, remediation_pr_url, status_changed_at, is_direct, package
       FROM scan_findings WHERE scan_id IN (${sph})`,
    )
    .all(...scanIds) as PostureFindingRow[];
  const proposals = db
    .prepare(`SELECT scan_id, status, pr_url FROM defender_proposals WHERE scan_id IN (${sph})`)
    .all(...scanIds) as PostureProposalRow[];
  return { targets, scans, findings, proposals };
}


// --- Scan package inventory -------------------------------------------------

export interface ScanPackageRow {
  scan_id: string;
  lockfile_path: string;
  manifest_path: string;
  ecosystem: string;
  name: string;
  version: string;
  is_direct: number;
}

export function appendScanPackages(scanId: string, rows: Array<Omit<ScanPackageRow, "scan_id">>): number {
  if (rows.length === 0) return 0;
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO scan_packages (scan_id, lockfile_path, manifest_path, ecosystem, name, version, is_direct)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  let n = 0;
  db.transaction(() => {
    for (const r of rows) n += stmt.run(scanId, r.lockfile_path, r.manifest_path, r.ecosystem, r.name, r.version, r.is_direct).changes;
  })();
  return n;
}

export function listScanPackages(scanId: string): ScanPackageRow[] {
  return getDb().prepare("SELECT * FROM scan_packages WHERE scan_id = ?").all(scanId) as ScanPackageRow[];
}

/** Every advisory id already recorded as a finding in a scan. */
export function knownAdvisoryIds(scanId: string): Set<string> {
  const rows = getDb().prepare("SELECT title, advisory_ids FROM scan_findings WHERE scan_id = ?").all(scanId) as Array<{ title: string; advisory_ids: string | null }>;
  const out = new Set<string>();
  for (const r of rows) {
    out.add(r.title);
    if (r.advisory_ids) for (const id of JSON.parse(r.advisory_ids) as string[]) out.add(id);
  }
  return out;
}

// --- Alerts (CVE watch) -----------------------------------------------------

export interface Alert {
  id: string;
  project_id: string;
  target_id: string;
  scan_id: string;
  advisory_id: string;
  aliases: string | null;
  severity: Finding["severity"];
  ecosystem: string;
  package: string;
  installed_version: string;
  fixed_version: string | null;
  manifest_path: string;
  summary: string;
  published_at: string | null;
  detected_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
}

export function createAlert(a: Omit<Alert, "id" | "detected_at" | "acknowledged_at" | "acknowledged_by">): Alert | null {
  const id = randomUUID();
  const r = getDb()
    .prepare(
      `INSERT OR IGNORE INTO defender_alerts
       (id, project_id, target_id, scan_id, advisory_id, aliases, severity, ecosystem, package, installed_version, fixed_version, manifest_path, summary, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, a.project_id, a.target_id, a.scan_id, a.advisory_id, a.aliases, a.severity, a.ecosystem, a.package, a.installed_version, a.fixed_version, a.manifest_path, a.summary, a.published_at);
  if (r.changes === 0) return null; // already alerted for this target/advisory/package/version
  return getDb().prepare("SELECT * FROM defender_alerts WHERE id = ?").get(id) as Alert;
}

export function existingAlertIds(targetId: string): Set<string> {
  const rows = getDb().prepare("SELECT advisory_id, aliases FROM defender_alerts WHERE target_id = ?").all(targetId) as Array<{ advisory_id: string; aliases: string | null }>;
  const out = new Set<string>();
  for (const r of rows) {
    out.add(r.advisory_id);
    if (r.aliases) for (const id of JSON.parse(r.aliases) as string[]) out.add(id);
  }
  return out;
}

export interface AlertWithContext extends Alert {
  project_slug: string;
  project_name: string;
  target_label: string;
}

export function listAlerts(projectIds: string[], opts: { open?: boolean; limit?: number } = {}): AlertWithContext[] {
  if (projectIds.length === 0) return [];
  const ph = projectIds.map(() => "?").join(",");
  const where = opts.open ? "AND a.acknowledged_at IS NULL" : "";
  return getDb()
    .prepare(
      `SELECT a.*, p.slug AS project_slug, p.name AS project_name, t.label AS target_label
       FROM defender_alerts a
       JOIN projects p ON p.id = a.project_id
       JOIN scan_targets t ON t.id = a.target_id
       WHERE a.project_id IN (${ph}) ${where}
       ORDER BY CASE a.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
                a.detected_at DESC
       LIMIT ?`,
    )
    .all(...projectIds, opts.limit ?? 200) as AlertWithContext[];
}

export function acknowledgeAlert(id: string, userId: string): Alert | null {
  const db = getDb();
  const r = db.prepare("UPDATE defender_alerts SET acknowledged_at = datetime('now'), acknowledged_by = ? WHERE id = ? AND acknowledged_at IS NULL").run(userId, id);
  if (r.changes === 0) return null;
  return db.prepare("SELECT * FROM defender_alerts WHERE id = ?").get(id) as Alert;
}

/** Alerts for a target become redundant once a scan records the advisory as a finding. */
export function acknowledgeAlertsCoveredByScan(targetId: string, scanId: string): number {
  const known = knownAdvisoryIds(scanId);
  const open = getDb().prepare("SELECT id, advisory_id, aliases FROM defender_alerts WHERE target_id = ? AND acknowledged_at IS NULL").all(targetId) as Array<{ id: string; advisory_id: string; aliases: string | null }>;
  let n = 0;
  for (const a of open) {
    const ids = [a.advisory_id, ...(a.aliases ? (JSON.parse(a.aliases) as string[]) : [])];
    if (ids.some((id) => known.has(id))) {
      getDb().prepare("UPDATE defender_alerts SET acknowledged_at = datetime('now') WHERE id = ?").run(a.id);
      n++;
    }
  }
  return n;
}

// --- Meta -------------------------------------------------------------------

export function metaGet(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM defender_meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function metaSet(key: string, value: string): void {
  getDb()
    .prepare("INSERT INTO defender_meta (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .run(key, value);
}
