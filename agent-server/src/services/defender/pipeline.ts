// The deterministic scan pipeline. No model is involved anywhere in this file:
// checkout -> lockfile inventory -> OSV match -> audit corroboration -> persist.
// Lockfile contents never reach an LLM; only the resulting findings do.

import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import type { ScanTarget, Scan, Finding, FindingDiff, NewFinding, Severity } from "../../db/repositories/scan-repo-types.js";
import { createScan, completeScan, appendFindings, diffFindings, getLatestCompletedScan, listFindings } from "../../db/repositories/scan-repo.js";
import { osvCacheGet, osvCachePut, inheritTriage, appendScanPackages, acknowledgeAlertsCoveredByScan } from "../../db/repositories/defender-repo.js";
import { discoverLockfiles, parseLockfile } from "./parsers/index.js";
import { OsvClient, fixedVersionFor, severityOf, primaryAdvisoryId, type OsvVuln } from "./osv-client.js";
import { runAuditFor, type AuditAdvisory } from "./audit-runner.js";
import { createWorkspace, type Workspace } from "./workspace.js";
import { cloneInto, defaultBranch, headSha, isFileTarget, fileTargetPath, parseGitHubRepo, type RepoRef } from "./git.js";
import type { DependencyVulnerability, ParsedLockfile, Ecosystem } from "./types.js";

export type ProgressSink = (msg: Record<string, unknown>) => void | Promise<void>;

export interface Checkout {
  runId: string;
  repoDir: string;
  /** null for file:// targets, which are scanned in place and never written to. */
  workspace: Workspace | null;
  repo: RepoRef | null;
  defaultBranch: string | null;
  headSha: string | null;
  readOnly: boolean;
}

/**
 * Materialise the target: clone GitHub repos into a fresh workspace, or point
 * at the local path for file:// targets. The caller disposes the workspace.
 */
export async function prepareCheckout(target: ScanTarget, opts: { githubToken?: string; ref?: string; onProgress?: ProgressSink }): Promise<Checkout> {
  const runId = randomUUID();
  if (isFileTarget(target.base_url)) {
    const dir = fileTargetPath(target.base_url);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      throw new Error(`file target does not exist or is not a directory: ${dir}`);
    }
    await opts.onProgress?.({ type: "defender", phase: "checkout", mode: "file", path: dir });
    return { runId, repoDir: dir, workspace: null, repo: null, defaultBranch: null, headSha: null, readOnly: true };
  }
  const repo = parseGitHubRepo(target.base_url);
  const workspace = await createWorkspace(runId);
  const repoDir = `${workspace.dir}/repo`;
  await opts.onProgress?.({ type: "defender", phase: "checkout", mode: "clone", repo: `${repo.owner}/${repo.name}` });
  try {
    await cloneInto(repoDir, repo, { ref: opts.ref, token: opts.githubToken });
  } catch (err) {
    await workspace.dispose();
    throw err;
  }
  const [branch, sha] = await Promise.all([defaultBranch(repoDir), headSha(repoDir)]);
  return { runId, repoDir, workspace, repo, defaultBranch: branch, headSha: sha, readOnly: false };
}

export interface ScanOptions {
  trigger: "manual" | "scheduled";
  triggeredBy?: string;
  onProgress?: ProgressSink;
  /** Injected for tests. */
  osvClient?: OsvClient;
  /** Skip npm/bun audit (tests, or hosts without network access to the registry). */
  skipAudits?: boolean;
}

export interface ScanResult {
  scan: Scan;
  inventory: ParsedLockfile[];
  vulnerabilities: DependencyVulnerability[];
  findings: Finding[];
  diff: FindingDiff;
}

const OSV_ECOSYSTEMS: ReadonlySet<Ecosystem> = new Set(["npm", "crates.io", "PyPI"]);

function defaultOsvClient(log: (line: string) => void): OsvClient {
  return new OsvClient({ cache: { get: osvCacheGet, put: osvCachePut }, log });
}

/** Scan a prepared checkout and persist the findings as a new scan row. */
export async function scanCheckout(target: ScanTarget, checkout: Checkout, opts: ScanOptions): Promise<ScanResult> {
  const progress = opts.onProgress ?? (() => {});
  const log = (line: string) => void progress({ type: "defender", phase: "log", line });
  const scan = createScan({ projectId: target.project_id, targetId: target.id, trigger: opts.trigger, triggeredBy: opts.triggeredBy });
  let requestCount = 0;

  try {
    // 1. Inventory
    const refs = discoverLockfiles(checkout.repoDir);
    await progress({ type: "defender", phase: "inventory", lockfiles: refs.map((r) => r.path) });
    const inventory: ParsedLockfile[] = [];
    for (const ref of refs) {
      try {
        inventory.push(parseLockfile(checkout.repoDir, ref));
      } catch (err) {
        log(`skipping ${ref.path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 2. OSV match
    const osv = opts.osvClient ?? defaultOsvClient(log);
    const before = osv.requestCount;
    const vulns = await matchAgainstOsv(inventory, osv, progress);
    requestCount += osv.requestCount - before;

    // 3. Audit corroboration
    if (!opts.skipAudits) {
      for (const parsed of inventory) {
        if (parsed.format !== "npm-lock-v3" && parsed.format !== "bun-lock") continue;
        try {
          const result = await runAuditFor(checkout.repoDir, parsed);
          if (!result) continue;
          await progress({ type: "defender", phase: "audit", tool: result.tool, lockfile: parsed.path, ok: result.ok, advisories: result.advisories.length, note: result.note });
          if (result.ok) mergeAudit(vulns, result.advisories, parsed);
        } catch (err) {
          log(`audit failed for ${parsed.path}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // 4. Persist
    const newFindings = vulns.map(toNewFinding);
    const findings = appendFindings(scan.id, newFindings);
    appendScanPackages(
      scan.id,
      inventory.flatMap((p) =>
        p.packages.map((pkg) => ({ lockfile_path: p.path, manifest_path: p.manifestPath, ecosystem: p.ecosystem, name: pkg.name, version: pkg.version, is_direct: pkg.direct ? 1 : 0 })),
      ),
    );
    const supersededAlerts = acknowledgeAlertsCoveredByScan(target.id, scan.id);
    if (supersededAlerts > 0) log(`${supersededAlerts} feed alert(s) now recorded as findings`);
    const inherited = inheritTriage(scan.id);
    const previous = getLatestCompletedScan(target.id, scan.id);
    const refreshed = inherited > 0 ? listFindings(scan.id) : findings;
    const diff = diffFindings(previous?.id ?? null, scan.id);
    const summary = {
      lockfiles: inventory.map((p) => ({ path: p.path, ecosystem: p.ecosystem, packages: p.packages.length })),
      packages: inventory.reduce((n, p) => n + p.packages.length, 0),
      findings: refreshed.length,
      bySeverity: countBySeverity(refreshed),
      added: diff.added.length,
      resolved: diff.resolved.length,
      headSha: checkout.headSha,
    };
    const done = completeScan({ scanId: scan.id, status: "completed", requestCount, summary });
    await progress({ type: "defender", phase: "done", scanId: scan.id, summary });
    return { scan: done, inventory, vulnerabilities: vulns, findings: refreshed, diff };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    completeScan({ scanId: scan.id, status: "failed", requestCount, summary: {}, error: message.slice(0, 2000) });
    throw err;
  }
}

async function matchAgainstOsv(
  inventory: ParsedLockfile[],
  osv: OsvClient,
  progress: ProgressSink,
): Promise<DependencyVulnerability[]> {
  // Unique (ecosystem, name, version) across all lockfiles, remembering where each came from.
  type Loc = { lockfile: ParsedLockfile; direct: boolean };
  const byKey = new Map<string, { ecosystem: Ecosystem; name: string; version: string; locs: Loc[] }>();
  for (const parsed of inventory) {
    if (!OSV_ECOSYSTEMS.has(parsed.ecosystem)) continue;
    for (const pkg of parsed.packages) {
      const key = `${parsed.ecosystem}:${pkg.name}:${pkg.version}`;
      const entry = byKey.get(key) ?? { ecosystem: parsed.ecosystem, name: pkg.name, version: pkg.version, locs: [] };
      entry.locs.push({ lockfile: parsed, direct: pkg.direct });
      byKey.set(key, entry);
    }
  }
  const entries = [...byKey.values()];
  await progress({ type: "defender", phase: "osv", queries: entries.length });
  if (entries.length === 0) return [];

  const idsPer = await osv.queryBatch(entries.map((e) => ({ ecosystem: e.ecosystem, name: e.name, version: e.version })));

  const vulnIds = new Set<string>();
  idsPer.forEach((ids) => ids.forEach((id) => vulnIds.add(id)));
  const vulnById = new Map<string, OsvVuln>();
  // Advisory records are independent; fetch a handful at a time (OSV tolerates
  // modest parallelism, and a sequential walk of ~600 ids takes minutes).
  const ids = [...vulnIds];
  const PARALLEL = 8;
  for (let i = 0; i < ids.length; i += PARALLEL) {
    await Promise.all(
      ids.slice(i, i + PARALLEL).map(async (id) => {
        try {
          vulnById.set(id, await osv.getVuln(id));
        } catch (err) {
          await progress({ type: "defender", phase: "log", line: `osv: could not fetch ${id}: ${String(err)}` });
        }
      }),
    );
  }

  const out: DependencyVulnerability[] = [];
  entries.forEach((entry, i) => {
    for (const id of idsPer[i]) {
      const vuln = vulnById.get(id);
      if (!vuln || (vuln as { withdrawn?: string }).withdrawn) continue;
      const { severity } = severityOf(vuln);
      const fixed = fixedVersionFor(vuln, entry.ecosystem, entry.name, entry.version);
      const primary = primaryAdvisoryId(vuln);
      const aliases = Array.from(new Set([vuln.id, ...(vuln.aliases ?? [])]));
      for (const loc of entry.locs) {
        out.push({
          ecosystem: entry.ecosystem,
          package: entry.name,
          installedVersion: entry.version,
          fixedVersion: fixed,
          advisoryIds: aliases,
          primaryId: primary,
          severity,
          summary: vuln.summary ?? primary,
          details: (vuln.details ?? "").slice(0, 2000),
          manifestPath: loc.lockfile.manifestPath,
          lockfilePath: loc.lockfile.path,
          direct: loc.direct,
          references: (vuln.references ?? []).map((r) => r.url).slice(0, 10),
          source: "osv",
        });
      }
    }
  });
  return dedupe(out);
}

/** One finding per (manifest, package, primary advisory). Keeps the highest installed version seen. */
function dedupe(list: DependencyVulnerability[]): DependencyVulnerability[] {
  const seen = new Map<string, DependencyVulnerability>();
  for (const v of list) {
    const key = `${v.manifestPath}|${v.ecosystem}|${v.package}|${v.primaryId}`;
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, v);
      continue;
    }
    // Same advisory, several installed versions in one tree: keep the lower one (worse case) and union ids.
    const keep = prev.installedVersion <= v.installedVersion ? prev : v;
    keep.advisoryIds = Array.from(new Set([...prev.advisoryIds, ...v.advisoryIds]));
    keep.direct = prev.direct || v.direct;
    seen.set(key, keep);
  }
  return [...seen.values()];
}

function auditSeverity(text: string): Severity {
  const t = text.toLowerCase();
  if (t === "critical") return "critical";
  if (t === "high") return "high";
  if (t === "moderate" || t === "medium") return "medium";
  if (t === "low") return "low";
  return "info";
}

/** Add corroborating audit advisories. Audit never overrides OSV's fixed_version. */
function mergeAudit(vulns: DependencyVulnerability[], advisories: AuditAdvisory[], parsed: ParsedLockfile): void {
  for (const adv of advisories) {
    const ids = adv.advisoryIds;
    const existing = vulns.find(
      (v) => v.lockfilePath === parsed.path && v.package === adv.package && ids.some((id) => v.advisoryIds.includes(id)),
    );
    if (existing) {
      existing.advisoryIds = Array.from(new Set([...existing.advisoryIds, ...ids]));
      if (!existing.references.includes(`audit:${adv.tool}`)) existing.references.push(`audit:${adv.tool}`);
      continue;
    }
    const installed = parsed.packages.filter((p) => p.name === adv.package);
    if (installed.length === 0) continue;
    for (const pkg of installed) {
      vulns.push({
        ecosystem: parsed.ecosystem,
        package: adv.package,
        installedVersion: pkg.version,
        fixedVersion: null,
        advisoryIds: ids,
        primaryId: ids.find((i) => i.startsWith("GHSA-")) ?? ids[0] ?? `${adv.tool}-audit:${adv.package}`,
        severity: auditSeverity(adv.severity),
        summary: adv.title || `${adv.tool} audit advisory for ${adv.package}`,
        details: adv.vulnerableRange ? `Vulnerable range reported by ${adv.tool} audit: ${adv.vulnerableRange}` : "",
        manifestPath: parsed.manifestPath,
        lockfilePath: parsed.path,
        direct: pkg.direct,
        references: adv.url ? [adv.url, `audit:${adv.tool}`] : [`audit:${adv.tool}`],
        source: "audit",
      });
    }
  }
}

function toNewFinding(v: DependencyVulnerability): NewFinding {
  const remediation = v.fixedVersion
    ? `Upgrade ${v.package} from ${v.installedVersion} to ${v.fixedVersion} or later in ${v.manifestPath}.`
    : `No fixed version is published for ${v.primaryId}; consider replacing ${v.package} or applying a vendor mitigation.`;
  return {
    severity: v.severity,
    category: "dependency-cve",
    title: v.primaryId,
    description: [`${v.package}@${v.installedVersion} (${v.ecosystem}, ${v.direct ? "direct" : "transitive"}): ${v.summary}`, v.details].filter(Boolean).join("\n\n"),
    location: `${v.manifestPath}|${v.ecosystem}|${v.package}`,
    evidence: JSON.stringify({ lockfile: v.lockfilePath, references: v.references, source: v.source }),
    remediation,
    ecosystem: v.ecosystem,
    package: v.package,
    installedVersion: v.installedVersion,
    fixedVersion: v.fixedVersion,
    advisoryIds: v.advisoryIds,
    manifestPath: v.manifestPath,
    isDirect: v.direct,
  };
}

function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const out: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) out[f.severity]++;
  return out;
}
