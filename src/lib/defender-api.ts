// Typed client for the agent-server `/api/defender/*` routes. Response shapes
// mirror agent-server/src/routes/defender.ts.

import { authHeader, handleAuthFailure } from "./auth-token";

const BASE_URL = import.meta.env.VITE_AGENT_SERVER_URL || "http://localhost:3001";

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type FindingStatus = "open" | "resolved" | "accepted-risk" | "false-positive";
export type ProposalStatus = "proposed" | "applied" | "installed" | "tested" | "test-failed" | "pr-opened" | "failed";

export interface DefenderTarget {
  id: string;
  project_id: string;
  label: string;
  base_url: string;
  approved_at: string | null;
  approved_by: string | null;
  schedule_cron: string | null;
  active: number;
  created_at: string;
  in_flight: boolean;
}

export interface DefenderScanSummary {
  lockfiles?: Array<{ path: string; ecosystem: string; packages: number }>;
  packages?: number;
  findings?: number;
  bySeverity?: Record<Severity, number>;
  added?: number;
  resolved?: number;
  headSha?: string | null;
}

export interface DefenderScan {
  id: string;
  target_id: string;
  status: "queued" | "running" | "completed" | "failed" | "aborted";
  trigger: "manual" | "scheduled";
  started_at: string | null;
  completed_at: string | null;
  summary: DefenderScanSummary | null;
  error: string | null;
}

export interface DefenderFinding {
  id: string;
  scan_id: string;
  severity: Severity;
  title: string;
  description: string;
  status: FindingStatus;
  ecosystem: string | null;
  package: string | null;
  installed_version: string | null;
  fixed_version: string | null;
  advisory_ids: string[];
  manifest_path: string | null;
  is_direct: number | null;
  priority: "p0" | "p1" | "p2" | "p3" | null;
  reachability: "reachable" | "unreachable" | "unknown" | null;
  triage_note: string | null;
  remediation_pr_url: string | null;
  proposal_id: string | null;
  proposal_status: ProposalStatus | null;
  proposal_pr_url: string | null;
  first_seen_scan_id: string | null;
  evidence: { lockfile?: string; references?: string[]; source?: string } | null;
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers as Record<string, string> | undefined), ...authHeader() },
  }).then(handleAuthFailure);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export function listTargets(projectSlug: string): Promise<{ targets: DefenderTarget[] }> {
  return apiFetch(`/api/defender/targets?project=${encodeURIComponent(projectSlug)}`);
}

export function createTarget(input: { projectSlug: string; label: string; repoUrl: string; scheduleCron?: string }): Promise<{ target: DefenderTarget }> {
  return apiFetch(`/api/defender/targets`, { method: "POST", body: JSON.stringify(input) });
}

export function approveTarget(id: string, reason: string): Promise<{ target: DefenderTarget }> {
  return apiFetch(`/api/defender/targets/${id}/approve`, { method: "POST", body: JSON.stringify({ reason }) });
}

export function updateSchedule(id: string, scheduleCron: string | null): Promise<{ target: DefenderTarget }> {
  return apiFetch(`/api/defender/targets/${id}`, { method: "PATCH", body: JSON.stringify({ scheduleCron }) });
}

export function deleteTarget(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/defender/targets/${id}`, { method: "DELETE" });
}

export function listFindings(targetId: string, status?: FindingStatus): Promise<{ scan: DefenderScan | null; findings: DefenderFinding[] }> {
  const q = status ? `&status=${status}` : "";
  return apiFetch(`/api/defender/findings?targetId=${encodeURIComponent(targetId)}${q}`);
}

export function listScans(targetId: string): Promise<{ scans: DefenderScan[] }> {
  return apiFetch(`/api/defender/scans?targetId=${encodeURIComponent(targetId)}`);
}

export function setFindingStatus(id: string, status: FindingStatus): Promise<{ finding: DefenderFinding }> {
  return apiFetch(`/api/defender/findings/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
}

export interface RunCallbacks {
  onMessage: (data: unknown) => void;
  onDone: (data: unknown) => void;
  onError: (error: string) => void;
}

function streamRun(path: string, body: unknown, callbacks: RunCallbacks): AbortController {
  const controller = new AbortController();
  fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then(handleAuthFailure)
    .then(async (response) => {
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Request failed" }));
        callbacks.onError((err as { error?: string }).error ?? "Request failed");
        return;
      }
      const reader = response.body?.getReader();
      if (!reader) {
        callbacks.onError("No response stream");
        return;
      }
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "message";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            const dataStr = line.slice(5).trim();
            if (!dataStr) continue;
            let data: unknown;
            try {
              data = JSON.parse(dataStr);
            } catch {
              continue;
            }
            if (currentEvent === "done") {
              callbacks.onDone(data);
              return;
            }
            if (currentEvent === "error") {
              callbacks.onError((data as { error?: string }).error ?? "Run failed");
              return;
            }
            callbacks.onMessage(data);
          }
        }
      }
      callbacks.onDone({});
    })
    .catch((err) => {
      if (err instanceof DOMException && err.name === "AbortError") return;
      callbacks.onError(String(err));
    });
  return controller;
}

export function runScan(targetId: string, phase: "scan" | "scan+triage", callbacks: RunCallbacks): AbortController {
  return streamRun(`/api/defender/scan/${targetId}`, { phase }, callbacks);
}

export function runPatch(targetId: string, findingIds: string[], callbacks: RunCallbacks): AbortController {
  return streamRun(`/api/defender/patch/${targetId}`, { findingIds }, callbacks);
}

// --- Cross-project posture (CISO view) ------------------------------------

export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface TargetPosture {
  id: string;
  label: string;
  repoUrl: string;
  approved: boolean;
  scheduled: boolean;
  lastScanAt: string | null;
  lastScanAgeDays: number | null;
  stale: boolean;
  packages: number;
  open: SeverityCounts;
  trend: Array<{ at: string; findings: number }>;
}

export interface ProjectPosture {
  projectId: string;
  slug: string;
  name: string;
  targets: TargetPosture[];
  open: SeverityCounts;
  openTotal: number;
  openDirect: number;
  slaBreached: SeverityCounts;
  slaBreachedTotal: number;
  slaDueSoon: number;
  slaCompliance: number | null;
  p0: number;
  reachable: number;
  triaged: number;
  triageCoverage: number | null;
  withPr: number;
  prsOpened: number;
  acceptedRisk: number;
  falsePositive: number;
  medianTimeToRemediateDays: number | null;
  resolvedInWindow: number;
  coverage: { targets: number; approved: number; scheduled: number; stale: number; neverScanned: number };
  grade: "critical" | "serious" | "warning" | "good" | "unknown";
}

export interface Posture {
  generatedAt: string;
  sla: SeverityCounts;
  lookbackDays: number;
  totals: {
    projects: number;
    targets: number;
    open: SeverityCounts;
    openTotal: number;
    slaBreachedTotal: number;
    slaCompliance: number | null;
    p0: number;
    triageCoverage: number | null;
    prsOpened: number;
    withPr: number;
    acceptedRisk: number;
    medianTimeToRemediateDays: number | null;
    staleTargets: number;
    neverScanned: number;
  };
  projects: ProjectPosture[];
}

export function getPosture(): Promise<Posture> {
  return apiFetch(`/api/defender/posture`);
}

// --- CVE watch alerts ------------------------------------------------------

export interface DefenderAlert {
  id: string;
  project_id: string;
  project_slug: string;
  project_name: string;
  target_id: string;
  target_label: string;
  advisory_id: string;
  aliases: string[];
  severity: Severity;
  ecosystem: string;
  package: string;
  installed_version: string;
  fixed_version: string | null;
  manifest_path: string;
  summary: string;
  published_at: string | null;
  detected_at: string;
  acknowledged_at: string | null;
}

export interface AlertsResponse {
  alerts: DefenderAlert[];
  lastCheckedAt: string | null;
  lastError: string | null;
  stale: boolean;
  running: boolean;
}

export function listAlerts(open = true): Promise<AlertsResponse> {
  return apiFetch(`/api/defender/alerts?open=${open ? "1" : "0"}`);
}

export function runCveWatch(ifStale: boolean): Promise<{ ran: boolean; reason?: string; newAlerts?: number; checkedTargets?: number; checkedPackages?: number; lastCheckedAt?: string | null; error?: string }> {
  return apiFetch(`/api/defender/cve-watch/run${ifStale ? "?ifStale=1" : ""}`, { method: "POST" });
}

export function acknowledgeAlert(id: string): Promise<{ alert: DefenderAlert }> {
  return apiFetch(`/api/defender/alerts/${id}/ack`, { method: "POST" });
}
