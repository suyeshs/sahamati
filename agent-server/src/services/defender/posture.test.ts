import { describe, it, expect } from "vitest";
import { computePosture, slaDaysFromEnv, parseDbTime } from "./posture.js";
import type { ScanTarget } from "../../db/repositories/scan-repo-types.js";
import type { PostureFindingRow, PostureScanRow } from "../../db/repositories/defender-repo.js";

const NOW = new Date("2026-10-28T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString().slice(0, 19).replace("T", " ");

function target(id: string, projectId: string, extra: Partial<ScanTarget> = {}): ScanTarget {
  return {
    id, project_id: projectId, label: id, base_url: `https://github.com/example/${id}`, environment: "dev",
    approved_by: "u", approved_at: daysAgo(30), approval_reason: "t", scan_profile: "dependency-cve", schedule_cron: "0 2 * * *",
    active: 1, auth_credential_id: null, created_by: "u", created_at: daysAgo(30), updated_at: daysAgo(30), ...extra,
  };
}

function scan(id: string, targetId: string, ago: number, findings: number): PostureScanRow {
  return { id, target_id: targetId, started_at: daysAgo(ago), completed_at: daysAgo(ago), summary: JSON.stringify({ findings, packages: 100 }) };
}

function finding(scanId: string, fp: string, severity: PostureFindingRow["severity"], extra: Partial<PostureFindingRow> = {}): PostureFindingRow {
  return { id: `${scanId}-${fp}`, scan_id: scanId, fingerprint: fp, severity, status: "open", priority: null, reachability: null, remediation_pr_url: null, status_changed_at: null, is_direct: 1, package: "pkg-test-001", ...extra };
}

describe("slaDaysFromEnv", () => {
  it("uses defaults and accepts overrides", () => {
    expect(slaDaysFromEnv(undefined)).toEqual({ critical: 7, high: 30, medium: 90, low: 180, info: 365 });
    expect(slaDaysFromEnv("critical=3, high=14, bogus=1, low=x")).toMatchObject({ critical: 3, high: 14, low: 180 });
  });
  it("parses SQLite timestamps as UTC", () => {
    expect(parseDbTime("2026-10-28 12:00:00")?.toISOString()).toBe("2026-10-28T12:00:00.000Z");
    expect(parseDbTime(null)).toBeNull();
  });
});

describe("computePosture", () => {
  const projects = [{ id: "p1", slug: "aa-one", name: "AA One" }, { id: "p2", slug: "fip-two", name: "FIP Two" }];

  it("computes SLA breaches from first-seen time across scan history", () => {
    const scans = [scan("s1", "t1", 20, 2), scan("s2", "t1", 1, 2)];
    const findings = [
      finding("s1", "crit-old", "critical"), finding("s1", "high-new", "high"),
      finding("s2", "crit-old", "critical", { priority: "p0", reachability: "reachable" }), finding("s2", "high-new", "high"),
    ];
    const r = computePosture({ projects, targets: [target("t1", "p1")], scans, findings, proposals: [], now: NOW });
    const p1 = r.projects.find((p) => p.projectId === "p1")!;
    expect(p1.open).toMatchObject({ critical: 1, high: 1 });
    expect(p1.slaBreached.critical).toBe(1); // 20 days old > 7-day SLA
    expect(p1.slaBreached.high).toBe(0); // 20 days < 30
    expect(p1.slaDueSoon).toBe(0);
    expect(p1.slaCompliance).toBe(0.5);
    expect(p1.p0).toBe(1);
    expect(p1.triageCoverage).toBe(0.5);
    expect(p1.grade).toBe("critical");
    expect(p1.coverage).toEqual({ targets: 1, approved: 1, scheduled: 1, stale: 0, neverScanned: 0 });
    expect(p1.targets[0].trend.map((x) => x.findings)).toEqual([2, 2]);
  });

  it("derives time-to-remediate from disappearance and from human resolution", () => {
    const scans = [scan("s1", "t1", 30, 2), scan("s2", "t1", 10, 1), scan("s3", "t1", 2, 1)];
    const findings = [
      finding("s1", "a", "high"), finding("s1", "b", "medium"),
      finding("s2", "b", "medium"), // "a" disappeared at s2: resolved after 20 days
      finding("s3", "b", "medium", { status: "resolved", status_changed_at: daysAgo(1) }), // closed by a person after 29 days
    ];
    const r = computePosture({ projects, targets: [target("t1", "p1")], scans, findings, proposals: [], now: NOW });
    const p1 = r.projects.find((p) => p.projectId === "p1")!;
    expect(p1.resolvedInWindow).toBe(2);
    expect(p1.medianTimeToRemediateDays).toBe(24.5);
    expect(p1.openTotal).toBe(0);
    expect(p1.grade).toBe("good");
    expect(r.totals.medianTimeToRemediateDays).toBe(24.5);
  });

  it("flags stale and never-scanned targets and counts exceptions and PRs", () => {
    const targets = [target("t1", "p2"), target("t2", "p2", { schedule_cron: null, approved_at: null })];
    const scans = [scan("s1", "t1", 12, 3)];
    const findings = [
      finding("s1", "x", "medium", { remediation_pr_url: "https://github.com/example/t1/pull/7" }),
      finding("s1", "y", "low", { status: "accepted-risk" }),
      finding("s1", "z", "low", { status: "false-positive" }),
    ];
    const proposals = [{ scan_id: "s1", status: "pr-opened" as const, pr_url: "https://github.com/example/t1/pull/7" }];
    const r = computePosture({ projects, targets, scans, findings, proposals, now: NOW });
    const p2 = r.projects.find((p) => p.projectId === "p2")!;
    expect(p2.coverage).toEqual({ targets: 2, approved: 1, scheduled: 1, stale: 1, neverScanned: 1 });
    expect(p2.targets[0].stale).toBe(true);
    expect(p2.acceptedRisk).toBe(1);
    expect(p2.falsePositive).toBe(1);
    expect(p2.withPr).toBe(1);
    expect(p2.prsOpened).toBe(1);
    expect(p2.openTotal).toBe(1);
    expect(p2.grade).toBe("warning");
    expect(r.totals.staleTargets).toBe(1);
    expect(r.totals.neverScanned).toBe(1);
    const p1 = r.projects.find((p) => p.projectId === "p1")!;
    expect(p1.grade).toBe("unknown");
  });

  it("orders projects worst first", () => {
    const scans = [scan("s1", "t1", 1, 1), scan("s2", "t2", 1, 1)];
    const findings = [finding("s1", "a", "low"), finding("s2", "b", "critical")];
    const r = computePosture({ projects, targets: [target("t1", "p1"), target("t2", "p2")], scans, findings, proposals: [], now: NOW });
    expect(r.projects.map((p) => p.projectId)).toEqual(["p2", "p1"]);
  });
});
