import { createHash } from "crypto";

export type ScanStatus = "queued" | "running" | "completed" | "failed" | "aborted";
export type ScanTrigger = "manual" | "scheduled";
export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type FindingStatus = "open" | "resolved" | "accepted-risk" | "false-positive";
export type Environment = "dev" | "staging" | "uat" | "prod";

export const SEVERITY_RANK: Record<Severity, number> = {
  info: 1,
  low: 2,
  medium: 3,
  high: 4,
  critical: 5,
};

export interface ScanTarget {
  id: string;
  project_id: string;
  label: string;
  base_url: string;
  environment: Environment;
  approved_by: string | null;
  approved_at: string | null;
  approval_reason: string | null;
  scan_profile: string;
  schedule_cron: string | null;
  active: number;
  auth_credential_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Scan {
  id: string;
  project_id: string;
  target_id: string;
  status: ScanStatus;
  trigger: ScanTrigger;
  triggered_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  request_count: number;
  summary: string | null;
  report_path: string | null;
  error: string | null;
}

export interface Finding {
  id: string;
  scan_id: string;
  fingerprint: string;
  severity: Severity;
  category: string;
  cwe: string | null;
  title: string;
  description: string;
  location: string;
  evidence: string | null;
  remediation: string | null;
  status: FindingStatus;
  first_seen_scan_id: string | null;
  created_at: string;
}

export interface NewFinding {
  fingerprint?: string;
  severity: Severity;
  category: string;
  cwe?: string;
  title: string;
  description: string;
  location: string;
  evidence?: string;
  remediation?: string;
}

export interface FindingDiff {
  added: Finding[];
  resolved: Finding[];
  severityUp: Array<{ current: Finding; previous: Finding }>;
  reopened: Finding[];
  unchanged: Finding[];
}

/**
 * Stable per-finding fingerprint over the dimensions that should NOT change
 * between runs of the same scanner finding the same flaw. Excludes `evidence`
 * (response-snapshot-specific) and `description` (model-generated wording).
 */
export function computeFingerprint(input: { category: string; location: string; title: string }): string {
  const h = createHash("sha256");
  h.update(input.category.trim().toLowerCase());
  h.update("\x1e");
  h.update(input.location.trim().toLowerCase());
  h.update("\x1e");
  h.update(input.title.trim().toLowerCase());
  return h.digest("hex");
}

/**
 * Pure diff between two finding lists. The DB-aware diffFindings in scan-repo.ts
 * wraps this after fetching both scans' findings from SQLite.
 */
export function diffFindingsLists(previous: Finding[], current: Finding[]): FindingDiff {
  const prevByFp = new Map(previous.map((f) => [f.fingerprint, f]));
  const currByFp = new Map(current.map((f) => [f.fingerprint, f]));

  const added: Finding[] = [];
  const severityUp: Array<{ current: Finding; previous: Finding }> = [];
  const reopened: Finding[] = [];
  const unchanged: Finding[] = [];

  for (const c of current) {
    const p = prevByFp.get(c.fingerprint);
    if (!p) {
      added.push(c);
      continue;
    }
    if (p.status === "resolved" && c.status === "open") {
      reopened.push(c);
      continue;
    }
    if (SEVERITY_RANK[c.severity] > SEVERITY_RANK[p.severity]) {
      severityUp.push({ current: c, previous: p });
      continue;
    }
    unchanged.push(c);
  }

  const resolved = previous.filter(
    (p) => p.status === "open" && !currByFp.has(p.fingerprint)
  );

  return { added, resolved, severityUp, reopened, unchanged };
}

export function summarizeFindings(findings: Finding[]): Record<Severity, number> {
  const out: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) out[f.severity]++;
  return out;
}
