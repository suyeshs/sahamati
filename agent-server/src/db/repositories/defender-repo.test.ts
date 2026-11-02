import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Same bootstrap as agent-repo.test.ts: env must be set before the DB module loads.
let dbmod: typeof import("../index.js");
let scanRepo: typeof import("./scan-repo.js");
let repo: typeof import("./defender-repo.js");
let root: string;
let projectId: string;
let userId: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "sahamati-defender-repo-"));
  process.env.__SAHAMATI_ROOT = root;
  process.env.SAHAMATI_DB_KEY = "test-key-0123456789abcdef0123456789abcdef";
  dbmod = await import("../index.js");
  dbmod.initDb();
  // recordChange() writes to the sync log, whose tables are created at boot by
  // index.ts rather than by a migration.
  const sync = await import("../../sync/sync-engine.js");
  sync.initSyncTracking();
  scanRepo = await import("./scan-repo.js");
  repo = await import("./defender-repo.js");
  const db = dbmod.getDb();
  userId = "user-test-001";
  projectId = "project-test-001";
  db.prepare("INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, 'admin')").run(userId, "defender-test@sahamati.org.in", "Test");
  db.prepare("INSERT INTO projects (id, slug, name, created_by) VALUES (?, 'p-test', 'P', ?)").run(projectId, userId);
});

afterAll(() => {
  dbmod.closeDb();
  rmSync(root, { recursive: true, force: true });
  delete process.env.__SAHAMATI_ROOT;
  delete process.env.SAHAMATI_DB_KEY;
});

describe("defender repo", () => {
  let targetId: string;
  let firstScanId: string;
  let findingId: string;

  it("creates a dependency target with the dependency-cve profile", () => {
    const t = repo.createDependencyTarget({ projectId, label: "sahamati", repoUrl: "https://github.com/example/pkg-test-001", scheduleCron: "0 2 * * *", createdBy: userId });
    targetId = t.id;
    expect(t.scan_profile).toBe("dependency-cve");
    expect(t.environment).toBe("dev");
    expect(repo.listScheduledDependencyTargets()).toHaveLength(0); // not approved yet
    scanRepo.approveTarget({ targetId, approvedBy: userId, approvalReason: "test" });
    expect(repo.listScheduledDependencyTargets().map((x) => x.id)).toEqual([targetId]);
    expect(repo.listDependencyTargets(projectId)).toHaveLength(1);
  });

  it("stores dependency columns on findings and carries triage across scans", () => {
    const scan = scanRepo.createScan({ projectId, targetId, trigger: "manual", triggeredBy: userId });
    firstScanId = scan.id;
    const [f] = scanRepo.appendFindings(scan.id, [
      {
        severity: "high",
        category: "dependency-cve",
        title: "GHSA-test-0001-0001",
        description: "pkg-test-001@1.2.3: synthetic",
        location: "package.json|npm|pkg-test-001",
        evidence: JSON.stringify({ lockfile: "bun.lock" }),
        ecosystem: "npm",
        package: "pkg-test-001",
        installedVersion: "1.2.3",
        fixedVersion: "1.2.4",
        advisoryIds: ["GHSA-test-0001-0001", "CVE-2026-00001"],
        manifestPath: "package.json",
        isDirect: true,
      },
    ]);
    findingId = f.id;
    expect(f.ecosystem).toBe("npm");
    expect(f.fixed_version).toBe("1.2.4");
    expect(JSON.parse(f.advisory_ids!)).toEqual(["GHSA-test-0001-0001", "CVE-2026-00001"]);
    expect(f.is_direct).toBe(1);
    scanRepo.completeScan({ scanId: scan.id, status: "completed", requestCount: 1, summary: {} });

    const annotated = repo.annotateFinding({ findingId: f.id, priority: "p0", reachability: "reachable", note: "used in src/app.ts" });
    expect(annotated?.priority).toBe("p0");
    scanRepo.updateFindingStatus(f.id, "accepted-risk");

    // Second scan with the same fingerprint inherits triage and the accepted-risk status.
    const scan2 = scanRepo.createScan({ projectId, targetId, trigger: "scheduled" });
    const [f2] = scanRepo.appendFindings(scan2.id, [
      { severity: "high", category: "dependency-cve", title: "GHSA-test-0001-0001", description: "again", location: "package.json|npm|pkg-test-001", ecosystem: "npm", package: "pkg-test-001", installedVersion: "1.2.3", fixedVersion: "1.2.4", manifestPath: "package.json", isDirect: true },
    ]);
    expect(f2.fingerprint).toBe(f.fingerprint);
    expect(f2.first_seen_scan_id).toBe(scan.id);
    expect(repo.inheritTriage(scan2.id)).toBe(1);
    const inherited = repo.getFinding(f2.id)!;
    expect(inherited.priority).toBe("p0");
    expect(inherited.reachability).toBe("reachable");
    expect(inherited.status).toBe("accepted-risk");
    scanRepo.completeScan({ scanId: scan2.id, status: "completed", requestCount: 1, summary: {} });

    const latest = repo.listLatestFindings(targetId);
    expect(latest.scan?.id).toBe(scan2.id);
    expect(latest.findings).toHaveLength(1);
    expect(latest.findings[0].proposal_id).toBeNull();
  });

  it("tracks proposals through their status machine", () => {
    const p = repo.createProposal({ scanId: firstScanId, findingId, ecosystem: "npm", package: "pkg-test-001", manifestPath: "package.json", lockfilePath: "bun.lock", fromVersion: "1.2.3", toVersion: "1.2.4", strategy: "direct" });
    expect(p.status).toBe("proposed");
    expect(repo.updateProposal(p.id, { status: "applied" })?.status).toBe("applied");
    expect(repo.updateProposal(p.id, { status: "tested", testSummary: "default: passed" })?.test_summary).toBe("default: passed");
    expect(repo.updateProposal(p.id, { status: "pr-opened", prUrl: "https://github.com/example/pkg-test-001/pull/1" })?.pr_url).toContain("/pull/1");
    expect(repo.listProposals(firstScanId)).toHaveLength(1);
    expect(() => repo.updateProposal(p.id, { status: "bogus" as never })).toThrow();
  });

  it("round-trips the OSV cache", () => {
    expect(repo.osvCacheGet("query:npm:pkg-test-001:1.2.3")).toBeNull();
    repo.osvCachePut("query:npm:pkg-test-001:1.2.3", "[]");
    repo.osvCachePut("query:npm:pkg-test-001:1.2.3", '["GHSA-test-0001-0001"]');
    expect(repo.osvCacheGet("query:npm:pkg-test-001:1.2.3")).toBe('["GHSA-test-0001-0001"]');
  });

  it("detects a scan started in the current minute", () => {
    expect(repo.scanStartedThisMinute(targetId, new Date())).toBe(true);
    expect(repo.scanStartedThisMinute(targetId, new Date(Date.now() + 10 * 60_000))).toBe(false);
  });
});
