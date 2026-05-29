import { randomUUID } from "crypto";
import { getDb } from "../index.js";
import { recordChange } from "../../sync/sync-engine.js";
import {
  computeFingerprint,
  diffFindingsLists,
  type Environment,
  type Finding,
  type FindingDiff,
  type FindingStatus,
  type NewFinding,
  type Scan,
  type ScanStatus,
  type ScanTarget,
  type ScanTrigger,
} from "./scan-repo-types.js";

export {
  computeFingerprint,
  diffFindingsLists,
  summarizeFindings,
  SEVERITY_RANK,
} from "./scan-repo-types.js";
export type {
  Environment,
  Finding,
  FindingDiff,
  FindingStatus,
  NewFinding,
  Scan,
  ScanStatus,
  ScanTarget,
  ScanTrigger,
  Severity,
} from "./scan-repo-types.js";

// --- Targets ---

export function createTarget(params: {
  projectId: string;
  label: string;
  baseUrl: string;
  environment: Environment;
  scheduleCron?: string;
  createdBy: string;
}): ScanTarget {
  const id = randomUUID();
  const db = getDb();
  db.prepare(
    `INSERT INTO scan_targets (id, project_id, label, base_url, environment, schedule_cron, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.projectId,
    params.label,
    params.baseUrl,
    params.environment,
    params.scheduleCron ?? null,
    params.createdBy
  );
  const row = getTarget(id);
  if (!row) throw new Error("failed to read back target");
  recordChange("scan_targets", id, "INSERT", row as unknown as Record<string, unknown>);
  return row;
}

export function approveTarget(params: {
  targetId: string;
  approvedBy: string;
  approvalReason: string;
}): ScanTarget {
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE scan_targets
       SET approved_by = ?, approved_at = datetime('now'), approval_reason = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(params.approvedBy, params.approvalReason, params.targetId);
  if (result.changes === 0) throw new Error("target not found");
  const row = getTarget(params.targetId);
  if (!row) throw new Error("failed to read back target");
  recordChange("scan_targets", params.targetId, "UPDATE", row as unknown as Record<string, unknown>);
  return row;
}

export function setTargetCredential(targetId: string, credentialId: string | null): ScanTarget {
  const db = getDb();
  db.prepare(
    `UPDATE scan_targets SET auth_credential_id = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(credentialId, targetId);
  const row = getTarget(targetId);
  if (!row) throw new Error("target not found");
  recordChange("scan_targets", targetId, "UPDATE", row as unknown as Record<string, unknown>);
  return row;
}

export function listTargets(projectId: string): ScanTarget[] {
  return getDb()
    .prepare("SELECT * FROM scan_targets WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as ScanTarget[];
}

export function listScheduledTargets(): ScanTarget[] {
  return getDb()
    .prepare(
      `SELECT * FROM scan_targets
       WHERE active = 1 AND schedule_cron IS NOT NULL AND approved_at IS NOT NULL`
    )
    .all() as ScanTarget[];
}

export function getTarget(id: string): ScanTarget | null {
  return (
    (getDb().prepare("SELECT * FROM scan_targets WHERE id = ?").get(id) as ScanTarget) ?? null
  );
}

export function deleteTarget(id: string): boolean {
  const row = getTarget(id);
  const result = getDb().prepare("DELETE FROM scan_targets WHERE id = ?").run(id);
  if (result.changes > 0 && row) {
    recordChange("scan_targets", id, "DELETE", { id, project_id: row.project_id });
  }
  return result.changes > 0;
}

// --- Scans ---

export function createScan(params: {
  projectId: string;
  targetId: string;
  trigger: ScanTrigger;
  triggeredBy?: string;
}): Scan {
  const id = randomUUID();
  const db = getDb();
  db.prepare(
    `INSERT INTO scans (id, project_id, target_id, status, trigger, triggered_by, started_at)
     VALUES (?, ?, ?, 'running', ?, ?, datetime('now'))`
  ).run(id, params.projectId, params.targetId, params.trigger, params.triggeredBy ?? null);
  const row = getScan(id);
  if (!row) throw new Error("failed to read back scan");
  recordChange("scans", id, "INSERT", row as unknown as Record<string, unknown>);
  return row;
}

export function completeScan(params: {
  scanId: string;
  status: Exclude<ScanStatus, "queued" | "running">;
  requestCount: number;
  summary: Record<string, unknown>;
  reportPath?: string;
  error?: string;
}): Scan {
  const db = getDb();
  db.prepare(
    `UPDATE scans
     SET status = ?, completed_at = datetime('now'),
         request_count = ?, summary = ?, report_path = ?, error = ?
     WHERE id = ?`
  ).run(
    params.status,
    params.requestCount,
    JSON.stringify(params.summary),
    params.reportPath ?? null,
    params.error ?? null,
    params.scanId
  );
  const row = getScan(params.scanId);
  if (!row) throw new Error("scan not found");
  recordChange("scans", params.scanId, "UPDATE", row as unknown as Record<string, unknown>);
  return row;
}

export function getScan(id: string): Scan | null {
  return (getDb().prepare("SELECT * FROM scans WHERE id = ?").get(id) as Scan) ?? null;
}

export function listScans(projectId: string, targetId?: string): Scan[] {
  const db = getDb();
  if (targetId) {
    return db
      .prepare(
        `SELECT * FROM scans WHERE project_id = ? AND target_id = ?
         ORDER BY started_at DESC LIMIT 100`
      )
      .all(projectId, targetId) as Scan[];
  }
  return db
    .prepare("SELECT * FROM scans WHERE project_id = ? ORDER BY started_at DESC LIMIT 100")
    .all(projectId) as Scan[];
}

export function getLatestCompletedScan(targetId: string, beforeScanId?: string): Scan | null {
  const db = getDb();
  if (beforeScanId) {
    return (
      (db
        .prepare(
          `SELECT * FROM scans
           WHERE target_id = ? AND status = 'completed' AND id != ?
                 AND started_at < (SELECT started_at FROM scans WHERE id = ?)
           ORDER BY started_at DESC LIMIT 1`
        )
        .get(targetId, beforeScanId, beforeScanId) as Scan) ?? null
    );
  }
  return (
    (db
      .prepare(
        `SELECT * FROM scans
         WHERE target_id = ? AND status = 'completed'
         ORDER BY started_at DESC LIMIT 1`
      )
      .get(targetId) as Scan) ?? null
  );
}

// --- Findings ---

export function appendFindings(scanId: string, findings: NewFinding[]): Finding[] {
  if (findings.length === 0) return [];
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO scan_findings
     (id, scan_id, fingerprint, severity, category, cwe, title, description, location, evidence, remediation, first_seen_scan_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const inserted: Finding[] = [];
  db.transaction(() => {
    for (const f of findings) {
      const id = randomUUID();
      const fp =
        f.fingerprint ??
        computeFingerprint({ category: f.category, location: f.location, title: f.title });
      // Determine first_seen_scan_id from prior occurrences (any prior scan for the same target).
      const firstSeen = db
        .prepare(
          `SELECT sf.first_seen_scan_id, sf.scan_id
           FROM scan_findings sf
           JOIN scans s ON s.id = sf.scan_id
           WHERE sf.fingerprint = ?
             AND s.target_id = (SELECT target_id FROM scans WHERE id = ?)
           ORDER BY s.started_at ASC LIMIT 1`
        )
        .get(fp, scanId) as { first_seen_scan_id: string | null; scan_id: string } | undefined;
      const firstSeenId = firstSeen ? firstSeen.first_seen_scan_id ?? firstSeen.scan_id : scanId;
      stmt.run(
        id,
        scanId,
        fp,
        f.severity,
        f.category,
        f.cwe ?? null,
        f.title,
        f.description,
        f.location,
        f.evidence ?? null,
        f.remediation ?? null,
        firstSeenId
      );
      const row = db
        .prepare("SELECT * FROM scan_findings WHERE id = ?")
        .get(id) as Finding;
      inserted.push(row);
      recordChange("scan_findings", id, "INSERT", row as unknown as Record<string, unknown>);
    }
  })();
  return inserted;
}

export function listFindings(scanId: string): Finding[] {
  return getDb()
    .prepare("SELECT * FROM scan_findings WHERE scan_id = ? ORDER BY severity DESC, created_at ASC")
    .all(scanId) as Finding[];
}

export function updateFindingStatus(id: string, status: FindingStatus): Finding | null {
  const db = getDb();
  const result = db
    .prepare("UPDATE scan_findings SET status = ? WHERE id = ?")
    .run(status, id);
  if (result.changes === 0) return null;
  const row = db
    .prepare("SELECT * FROM scan_findings WHERE id = ?")
    .get(id) as Finding;
  recordChange("scan_findings", id, "UPDATE", row as unknown as Record<string, unknown>);
  return row;
}

export function diffFindings(previousScanId: string | null, currentScanId: string): FindingDiff {
  const current = listFindings(currentScanId);
  if (!previousScanId) {
    return { added: current, resolved: [], severityUp: [], reopened: [], unchanged: [] };
  }
  const previous = listFindings(previousScanId);
  return diffFindingsLists(previous, current);
}
