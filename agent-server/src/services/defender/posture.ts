// Cross-project security posture: the numbers a CISO reads (open exposure, SLA
// breaches, time to remediate, coverage, exceptions) computed deterministically
// from scan history. Pure over rows so it is unit-testable; the route loads rows.

import type { ScanTarget, Severity } from "../../db/repositories/scan-repo-types.js";
import type { PostureScanRow, PostureFindingRow, PostureProposalRow } from "../../db/repositories/defender-repo.js";

export interface SlaDays {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

/** Remediation SLA in days per severity. Override with SAHAMATI_DEFENDER_SLA_DAYS="critical=7,high=30,...". */
export function slaDaysFromEnv(raw = process.env.SAHAMATI_DEFENDER_SLA_DAYS): SlaDays {
  const sla: SlaDays = { critical: 7, high: 30, medium: 90, low: 180, info: 365 };
  for (const part of (raw ?? "").split(",")) {
    const [k, v] = part.split("=").map((x) => x?.trim());
    if (k && k in sla && /^\d+$/.test(v ?? "")) sla[k as keyof SlaDays] = parseInt(v, 10);
  }
  return sla;
}

export const STALE_SCAN_DAYS = 7;

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
  /** Open findings older than their severity's SLA. */
  slaBreached: SeverityCounts;
  slaBreachedTotal: number;
  /** Open findings that will breach within 7 days. */
  slaDueSoon: number;
  /** Share of open findings within SLA, 0-1; null when nothing is open. */
  slaCompliance: number | null;
  p0: number;
  reachable: number;
  triaged: number;
  triageCoverage: number | null;
  withPr: number;
  prsOpened: number;
  acceptedRisk: number;
  falsePositive: number;
  /** Days, over findings resolved in the lookback window; null without data. */
  medianTimeToRemediateDays: number | null;
  resolvedInWindow: number;
  coverage: { targets: number; approved: number; scheduled: number; stale: number; neverScanned: number };
  /** Worst state across the project, for sorting and the status chip. */
  grade: "critical" | "serious" | "warning" | "good" | "unknown";
}

export interface Posture {
  generatedAt: string;
  sla: SlaDays;
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

export interface PostureInput {
  projects: Array<{ id: string; slug: string; name: string }>;
  targets: ScanTarget[];
  scans: PostureScanRow[];
  findings: PostureFindingRow[];
  proposals: PostureProposalRow[];
  now?: Date;
  sla?: SlaDays;
  lookbackDays?: number;
}

const DAY_MS = 86_400_000;

/** SQLite datetime('now') strings are UTC without a zone marker. */
export function parseDbTime(s: string | null | undefined): Date | null {
  if (!s) return null;
  const iso = s.includes("T") ? s : `${s.replace(" ", "T")}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function emptyCounts(): SeverityCounts {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

function addCounts(a: SeverityCounts, b: SeverityCounts): void {
  for (const k of Object.keys(a) as Severity[]) a[k] += b[k];
}

function sum(c: SeverityCounts): number {
  return c.critical + c.high + c.medium + c.low + c.info;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function computePosture(input: PostureInput): Posture {
  const now = input.now ?? new Date();
  const sla = input.sla ?? slaDaysFromEnv();
  const lookbackDays = input.lookbackDays ?? 90;
  const lookbackStart = now.getTime() - lookbackDays * DAY_MS;

  const scansByTarget = new Map<string, PostureScanRow[]>();
  for (const s of input.scans) {
    const list = scansByTarget.get(s.target_id) ?? [];
    list.push(s);
    scansByTarget.set(s.target_id, list);
  }
  for (const list of scansByTarget.values()) {
    list.sort((a, b) => (parseDbTime(a.started_at)?.getTime() ?? 0) - (parseDbTime(b.started_at)?.getTime() ?? 0));
  }
  const findingsByScan = new Map<string, PostureFindingRow[]>();
  for (const f of input.findings) {
    const list = findingsByScan.get(f.scan_id) ?? [];
    list.push(f);
    findingsByScan.set(f.scan_id, list);
  }
  const proposalsByScan = new Map<string, PostureProposalRow[]>();
  for (const p of input.proposals) {
    const list = proposalsByScan.get(p.scan_id) ?? [];
    list.push(p);
    proposalsByScan.set(p.scan_id, list);
  }
  const targetsByProject = new Map<string, ScanTarget[]>();
  for (const t of input.targets) {
    const list = targetsByProject.get(t.project_id) ?? [];
    list.push(t);
    targetsByProject.set(t.project_id, list);
  }

  const projects: ProjectPosture[] = [];

  for (const project of input.projects) {
    const targets = targetsByProject.get(project.id) ?? [];
    const tp: TargetPosture[] = [];
    const open = emptyCounts();
    const slaBreached = emptyCounts();
    let slaDueSoon = 0;
    let openDirect = 0;
    let p0 = 0;
    let reachable = 0;
    let triaged = 0;
    let withPr = 0;
    let acceptedRisk = 0;
    let falsePositive = 0;
    const prUrls = new Set<string>();
    const ttr: number[] = [];
    let stale = 0;
    let neverScanned = 0;

    for (const t of targets) {
      const scans = scansByTarget.get(t.id) ?? [];
      const latest = scans[scans.length - 1];
      const lastScanAt = latest ? parseDbTime(latest.completed_at ?? latest.started_at) : null;
      const ageDays = lastScanAt ? (now.getTime() - lastScanAt.getTime()) / DAY_MS : null;
      const isStale = ageDays === null || ageDays > STALE_SCAN_DAYS;
      if (!latest) neverScanned++;
      else if (isStale) stale++;

      // First-seen time per fingerprint across this target's scan history, in scan order.
      const firstSeenAt = new Map<string, Date>();
      const lastPresentIdx = new Map<string, number>();
      scans.forEach((s, idx) => {
        const at = parseDbTime(s.completed_at ?? s.started_at) ?? now;
        for (const f of findingsByScan.get(s.id) ?? []) {
          if (!firstSeenAt.has(f.fingerprint)) firstSeenAt.set(f.fingerprint, at);
          lastPresentIdx.set(f.fingerprint, idx);
        }
      });

      // Scan-based resolution: a fingerprint absent from a later scan resolved at that scan's time.
      for (const [fp, idx] of lastPresentIdx) {
        if (idx >= scans.length - 1) continue;
        const resolvedAt = parseDbTime(scans[idx + 1].completed_at ?? scans[idx + 1].started_at);
        const seen = firstSeenAt.get(fp);
        if (!resolvedAt || !seen || resolvedAt.getTime() < lookbackStart) continue;
        ttr.push((resolvedAt.getTime() - seen.getTime()) / DAY_MS);
      }

      const targetOpen = emptyCounts();
      let packages = 0;
      if (latest) {
        try {
          packages = (JSON.parse(latest.summary ?? "{}") as { packages?: number }).packages ?? 0;
        } catch {
          packages = 0;
        }
        for (const f of findingsByScan.get(latest.id) ?? []) {
          if (f.status === "accepted-risk") acceptedRisk++;
          if (f.status === "false-positive") falsePositive++;
          if (f.status === "resolved") {
            const closedAt = parseDbTime(f.status_changed_at);
            const seen = firstSeenAt.get(f.fingerprint);
            if (closedAt && seen && closedAt.getTime() >= lookbackStart) ttr.push((closedAt.getTime() - seen.getTime()) / DAY_MS);
          }
          if (f.status !== "open") continue;
          targetOpen[f.severity]++;
          if (f.is_direct === 1) openDirect++;
          if (f.priority) triaged++;
          if (f.priority === "p0") p0++;
          if (f.reachability === "reachable") reachable++;
          if (f.remediation_pr_url) {
            withPr++;
            prUrls.add(f.remediation_pr_url);
          }
          const seen = firstSeenAt.get(f.fingerprint) ?? lastScanAt ?? now;
          const age = (now.getTime() - seen.getTime()) / DAY_MS;
          const limit = sla[f.severity];
          if (age > limit) slaBreached[f.severity]++;
          else if (limit - age <= 7) slaDueSoon++;
        }
        for (const p of proposalsByScan.get(latest.id) ?? []) if (p.status === "pr-opened" && p.pr_url) prUrls.add(p.pr_url);
      }
      addCounts(open, targetOpen);

      tp.push({
        id: t.id,
        label: t.label,
        repoUrl: t.base_url,
        approved: Boolean(t.approved_at),
        scheduled: Boolean(t.schedule_cron),
        lastScanAt: lastScanAt ? lastScanAt.toISOString() : null,
        lastScanAgeDays: ageDays === null ? null : round1(ageDays),
        stale: isStale,
        packages,
        open: targetOpen,
        trend: scans.slice(-10).map((s) => {
          let n = 0;
          try {
            n = (JSON.parse(s.summary ?? "{}") as { findings?: number }).findings ?? 0;
          } catch {
            n = 0;
          }
          return { at: (parseDbTime(s.completed_at ?? s.started_at) ?? now).toISOString(), findings: n };
        }),
      });
    }

    const openTotal = sum(open);
    const slaBreachedTotal = sum(slaBreached);
    const grade: ProjectPosture["grade"] =
      targets.length === 0 || neverScanned === targets.length
        ? "unknown"
        : slaBreached.critical > 0 || open.critical > 0
          ? "critical"
          : slaBreachedTotal > 0 || open.high > 0
            ? "serious"
            : openTotal > 0 || stale > 0
              ? "warning"
              : "good";

    projects.push({
      projectId: project.id,
      slug: project.slug,
      name: project.name,
      targets: tp,
      open,
      openTotal,
      openDirect,
      slaBreached,
      slaBreachedTotal,
      slaDueSoon,
      slaCompliance: openTotal === 0 ? null : round1(((openTotal - slaBreachedTotal) / openTotal) * 1000) / 1000,
      p0,
      reachable,
      triaged,
      triageCoverage: openTotal === 0 ? null : Math.round((triaged / openTotal) * 1000) / 1000,
      withPr,
      prsOpened: prUrls.size,
      acceptedRisk,
      falsePositive,
      medianTimeToRemediateDays: ttr.length ? round1(median(ttr)!) : null,
      resolvedInWindow: ttr.length,
      coverage: {
        targets: targets.length,
        approved: targets.filter((t) => t.approved_at).length,
        scheduled: targets.filter((t) => t.schedule_cron).length,
        stale,
        neverScanned,
      },
      grade,
    });
  }

  const gradeRank = { critical: 0, serious: 1, warning: 2, unknown: 3, good: 4 };
  projects.sort((a, b) => gradeRank[a.grade] - gradeRank[b.grade] || b.slaBreachedTotal - a.slaBreachedTotal || b.openTotal - a.openTotal);

  const totalOpen = emptyCounts();
  let slaBreachedTotal = 0;
  let p0 = 0;
  let triaged = 0;
  let prsOpened = 0;
  let withPr = 0;
  let acceptedRisk = 0;
  let staleTargets = 0;
  let neverScanned = 0;
  const allTtr: number[] = [];
  for (const p of projects) {
    addCounts(totalOpen, p.open);
    slaBreachedTotal += p.slaBreachedTotal;
    p0 += p.p0;
    triaged += p.triaged;
    prsOpened += p.prsOpened;
    withPr += p.withPr;
    acceptedRisk += p.acceptedRisk;
    staleTargets += p.coverage.stale;
    neverScanned += p.coverage.neverScanned;
    if (p.medianTimeToRemediateDays !== null) allTtr.push(...Array(p.resolvedInWindow).fill(p.medianTimeToRemediateDays));
  }
  const openTotal = sum(totalOpen);

  return {
    generatedAt: now.toISOString(),
    sla,
    lookbackDays,
    totals: {
      projects: projects.length,
      targets: input.targets.length,
      open: totalOpen,
      openTotal,
      slaBreachedTotal,
      slaCompliance: openTotal === 0 ? null : Math.round(((openTotal - slaBreachedTotal) / openTotal) * 1000) / 1000,
      p0,
      triageCoverage: openTotal === 0 ? null : Math.round((triaged / openTotal) * 1000) / 1000,
      prsOpened,
      withPr,
      acceptedRisk,
      medianTimeToRemediateDays: allTtr.length ? round1(median(allTtr)!) : null,
      staleTargets,
      neverScanned,
    },
    projects,
  };
}
