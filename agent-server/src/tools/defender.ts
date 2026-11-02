// Typed MCP tools for the defender agents. Built per run via a factory so the
// workspace path, scan id and GitHub token travel in a closure instead of
// process.env (safe for concurrent scheduled runs). Every mutation validates
// its arguments against the finding row in the DB; the model only ever picks
// *which* finding and *which* strategy.

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { discoverLockfiles, parseLockfile } from "../services/defender/parsers/index.js";
import { OsvClient } from "../services/defender/osv-client.js";
import { versionGte, VERSION_PATTERN } from "../services/defender/versions.js";
import { resolveInside } from "../services/defender/workspace.js";
import { applyBump, runInstall, runTests, bumpChangedFiles, ToolchainMissingError, type BumpSpec } from "../services/defender/bump.js";
import { checkoutNewBranch, commitFiles, pushBranch, openPullRequest, restoreFiles, type RepoRef } from "../services/defender/git.js";
import { buildPrBody, buildPrTitle } from "../services/defender/pr-template.js";
import {
  listLatestFindings,
  getFinding,
  annotateFinding,
  createProposal,
  getProposal,
  updateProposal,
  listProposals,
  setFindingPrUrl,
  osvCacheGet,
  osvCachePut,
  type Proposal,
} from "../db/repositories/defender-repo.js";
import type { Ecosystem } from "../services/defender/types.js";

export interface DefenderRunContext {
  runId: string;
  scanId: string;
  projectId: string;
  targetId: string;
  /** Checkout root. For file:// targets this is the live directory and is read-only. */
  repoDir: string;
  /** Per-run temp root; absent for file:// targets. */
  workspaceDir: string | null;
  readOnly: boolean;
  githubToken?: string;
  repo: RepoRef | null;
  defaultBranch: string | null;
  signal?: AbortSignal;
  log?: (line: string) => void;
}

const RelPath = z
  .string()
  .min(1)
  .max(512)
  .refine((p) => !p.includes("..") && !p.startsWith("/"), { message: "path must be relative and inside the repository" });

const AdvisoryId = z.string().regex(/^(GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}|RUSTSEC-\d{4}-\d{4}|PYSEC-\d{4}-\d+|CVE-\d{4}-\d{4,}|OSV-[\w-]+|MAL-\d{4}-\d+)$/);

function asJson(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function asError(message: string) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }], isError: true };
}

const STRATEGIES = ["direct", "override", "cargo-precise", "uv-constraint"] as const;

/** Which strategies make sense for an ecosystem; the tool rejects the rest. */
function strategyAllowed(ecosystem: string, strategy: (typeof STRATEGIES)[number], direct: boolean): string | null {
  switch (ecosystem) {
    case "npm":
      if (strategy === "direct" && !direct) return "package is transitive; use strategy \"override\"";
      if (strategy !== "direct" && strategy !== "override") return `strategy ${strategy} is not valid for npm`;
      return null;
    case "crates.io":
      if (strategy !== "direct" && strategy !== "cargo-precise") return `strategy ${strategy} is not valid for crates.io`;
      if (strategy === "direct" && !direct) return "package is transitive; use strategy \"cargo-precise\"";
      return null;
    case "PyPI":
      if (strategy !== "direct" && strategy !== "uv-constraint") return `strategy ${strategy} is not valid for PyPI`;
      return null;
    default:
      return `ecosystem ${ecosystem} is inventory-only; no bumps are supported`;
  }
}

function proposalToSpec(p: Proposal): BumpSpec {
  return {
    ecosystem: p.ecosystem as Ecosystem,
    package: p.package,
    manifestPath: p.manifest_path,
    lockfilePath: p.lockfile_path,
    fromVersion: p.from_version,
    toVersion: p.to_version,
    strategy: p.strategy,
  };
}

export function createDefenderMcpServer(ctx: DefenderRunContext) {
  const log = ctx.log ?? ((line: string) => console.log(`[defender:${ctx.runId.slice(0, 8)}] ${line}`));
  const osv = new OsvClient({ cache: { get: osvCacheGet, put: osvCachePut }, log });

  const requireWritable = (): string | null => {
    if (ctx.readOnly) return "this target is a local file:// path and is scan-only; patching requires a GitHub target";
    if (!ctx.repo || !ctx.githubToken) return "no GitHub repository or token is attached to this run";
    return null;
  };

  const revert = async (spec: BumpSpec) => {
    try {
      await restoreFiles(ctx.repoDir, bumpChangedFiles(spec));
    } catch (err) {
      log(`revert failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return createSdkMcpServer({
    name: "defender",
    version: "1.0.0",
    tools: [
      tool(
        "list_lockfiles",
        "List every supported lockfile in the repository with its ecosystem, format and manifest path.",
        {},
        async () => asJson({ lockfiles: discoverLockfiles(ctx.repoDir) }),
      ),

      tool(
        "parse_lockfile",
        "Parse one lockfile (repo-relative path from list_lockfiles) into its locked packages, marking direct dependencies.",
        { path: RelPath },
        async ({ path }) => {
          const ref = discoverLockfiles(ctx.repoDir).find((r) => r.path === path);
          if (!ref) return asError(`not a known lockfile: ${path}`);
          const parsed = parseLockfile(ctx.repoDir, ref);
          return asJson({ ...parsed, packageCount: parsed.packages.length });
        },
      ),

      tool(
        "get_advisory",
        "Fetch a public advisory record (GHSA, CVE, RUSTSEC, PYSEC or OSV id) with summary, details, affected ranges and references.",
        { id: AdvisoryId },
        async ({ id }) => {
          try {
            const v = await osv.getVuln(id);
            return asJson({
              id: v.id,
              aliases: v.aliases ?? [],
              summary: v.summary ?? "",
              details: (v.details ?? "").slice(0, 6000),
              severity: v.severity ?? [],
              databaseSeverity: v.database_specific?.severity ?? null,
              affected: (v.affected ?? []).map((a) => ({
                package: a.package,
                ranges: a.ranges,
                functions: (a as { ecosystem_specific?: { affected_functions?: string[] } }).ecosystem_specific?.affected_functions ?? [],
              })),
              references: (v.references ?? []).slice(0, 15),
              published: v.published ?? null,
              modified: v.modified ?? null,
            });
          } catch (err) {
            return asError(`advisory lookup failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        },
      ),

      tool(
        "list_findings",
        "List findings from the current scan. Optional filters: status (open|resolved|accepted-risk|false-positive) and minSeverity.",
        {
          status: z.enum(["open", "resolved", "accepted-risk", "false-positive"]).optional(),
          minSeverity: z.enum(["critical", "high", "medium", "low", "info"]).optional(),
        },
        async ({ status, minSeverity }) => {
          const rank = { info: 1, low: 2, medium: 3, high: 4, critical: 5 } as const;
          const { findings } = listLatestFindings(ctx.targetId, status ?? "open");
          const filtered = findings
            .filter((f) => f.scan_id === ctx.scanId)
            .filter((f) => !minSeverity || rank[f.severity] >= rank[minSeverity])
            .map((f) => ({
              id: f.id,
              severity: f.severity,
              advisory: f.title,
              advisoryIds: f.advisory_ids ? (JSON.parse(f.advisory_ids) as string[]) : [],
              ecosystem: f.ecosystem,
              package: f.package,
              installedVersion: f.installed_version,
              fixedVersion: f.fixed_version,
              manifestPath: f.manifest_path,
              direct: f.is_direct === 1,
              summary: f.description.split("\n")[0],
              status: f.status,
              priority: f.priority,
              reachability: f.reachability,
              triageNote: f.triage_note,
              proposalStatus: f.proposal_status,
              prUrl: f.proposal_pr_url ?? f.remediation_pr_url,
            }));
          const byPackage = new Map<string, { package: string; ecosystem: string | null; findings: number; worst: string; direct: boolean; fixedAvailable: number }>();
          for (const f of filtered) {
            const key = `${f.ecosystem}:${f.package}`;
            const cur = byPackage.get(key) ?? { package: f.package ?? "", ecosystem: f.ecosystem, findings: 0, worst: f.severity, direct: false, fixedAvailable: 0 };
            cur.findings++;
            if (rank[f.severity] > rank[cur.worst as keyof typeof rank]) cur.worst = f.severity;
            cur.direct = cur.direct || f.direct;
            if (f.fixedVersion) cur.fixedAvailable++;
            byPackage.set(key, cur);
          }
          return asJson({ scanId: ctx.scanId, count: filtered.length, packages: [...byPackage.values()], findings: filtered });
        },
      ),

      tool(
        "annotate_finding",
        "Record triage for one finding: priority (p0-p3), reachability (reachable|unreachable|unknown) and a short factual note (max 1000 chars, no file contents).",
        {
          findingId: z.string().uuid(),
          priority: z.enum(["p0", "p1", "p2", "p3"]),
          reachability: z.enum(["reachable", "unreachable", "unknown"]),
          note: z.string().min(1).max(1000),
        },
        async ({ findingId, priority, reachability, note }) => {
          const f = getFinding(findingId);
          if (!f || f.scan_id !== ctx.scanId) return asError("finding not found in the current scan");
          const row = annotateFinding({ findingId, priority, reachability, note });
          return asJson({ ok: true, id: row?.id, priority, reachability });
        },
      ),

      tool(
        "annotate_package",
        "Record the same triage verdict for EVERY open finding of one package in the current scan (use when reachability is a property of the package, which is the common case). Returns the number of findings updated.",
        {
          package: z.string().min(1).max(214),
          ecosystem: z.enum(["npm", "crates.io", "PyPI"]).optional(),
          priority: z.enum(["p0", "p1", "p2", "p3"]),
          reachability: z.enum(["reachable", "unreachable", "unknown"]),
          note: z.string().min(1).max(1000),
        },
        async ({ package: pkg, ecosystem, priority, reachability, note }) => {
          const { findings } = listLatestFindings(ctx.targetId, "open");
          const matches = findings.filter((f) => f.scan_id === ctx.scanId && f.package === pkg && (!ecosystem || f.ecosystem === ecosystem));
          if (matches.length === 0) return asError(`no open findings for package "${pkg}" in the current scan`);
          for (const f of matches) annotateFinding({ findingId: f.id, priority, reachability, note });
          return asJson({ ok: true, package: pkg, updated: matches.length, findingIds: matches.map((f) => f.id) });
        },
      ),

      tool(
        "propose_bump",
        "Propose upgrading the package behind a finding to a specific version. The package, ecosystem and manifest come from the finding; toVersion must be >= the published fixed version.",
        {
          findingId: z.string().uuid(),
          toVersion: z.string().regex(VERSION_PATTERN, "not a recognisable version string"),
          strategy: z.enum(STRATEGIES),
        },
        async ({ findingId, toVersion, strategy }) => {
          const denied = requireWritable();
          if (denied) return asError(denied);
          const f = getFinding(findingId);
          if (!f || f.scan_id !== ctx.scanId) return asError("finding not found in the current scan");
          if (f.status !== "open") return asError(`finding is ${f.status}, not open`);
          if (!f.ecosystem || !f.package || !f.installed_version || !f.manifest_path) return asError("finding has no dependency metadata");
          if (!f.fixed_version) return asError("no fixed version is published for this advisory; it cannot be bumped automatically");
          if (!versionGte(toVersion, f.fixed_version)) return asError(`toVersion ${toVersion} is below the fixed version ${f.fixed_version}`);
          const strategyErr = strategyAllowed(f.ecosystem, strategy, f.is_direct === 1);
          if (strategyErr) return asError(strategyErr);
          const evidence = f.evidence ? (JSON.parse(f.evidence) as { lockfile?: string }) : {};
          const lockfilePath = evidence.lockfile;
          if (!lockfilePath) return asError("finding does not record its lockfile");
          try {
            resolveInside(ctx.repoDir, f.manifest_path);
            resolveInside(ctx.repoDir, lockfilePath);
          } catch (err) {
            return asError(err instanceof Error ? err.message : String(err));
          }
          if (!existsSync(join(ctx.repoDir, f.manifest_path))) return asError(`manifest ${f.manifest_path} is missing from the checkout`);
          const already = listProposals(ctx.scanId).find((p) => p.finding_id === findingId && p.status !== "failed" && p.status !== "test-failed");
          if (already) return asError(`a proposal already exists for this finding: ${already.id} (${already.status})`);
          const proposal = createProposal({
            scanId: ctx.scanId,
            findingId,
            ecosystem: f.ecosystem,
            package: f.package,
            manifestPath: f.manifest_path,
            lockfilePath,
            fromVersion: f.installed_version,
            toVersion,
            strategy,
          });
          return asJson({ proposalId: proposal.id, package: f.package, from: f.installed_version, to: toVersion, strategy, manifestPath: f.manifest_path });
        },
      ),

      tool(
        "apply_bump",
        "Apply a proposed bump: rewrite the manifest and regenerate the lockfile in the isolated workspace. Reverts automatically on failure.",
        { proposalId: z.string().uuid() },
        async ({ proposalId }) => {
          const denied = requireWritable();
          if (denied) return asError(denied);
          const p = getProposal(proposalId);
          if (!p || p.scan_id !== ctx.scanId) return asError("proposal not found in this run");
          if (p.status !== "proposed") return asError(`proposal is ${p.status}; apply_bump expects "proposed"`);
          const spec = proposalToSpec(p);
          try {
            const result = await applyBump(ctx.repoDir, spec);
            if (!result.ok) {
              await revert(spec);
              updateProposal(p.id, { status: "failed", error: result.output.slice(0, 2000) });
              return asJson({ ok: false, proposalId, command: result.command, output: result.output });
            }
            // A caret/tilde requirement may resolve above the proposed version;
            // record what the lockfile actually pinned so the PR reports what was tested.
            const resolved = resolvedLockedVersion(ctx.repoDir, spec.lockfilePath, spec.package);
            updateProposal(p.id, { status: "applied", toVersion: resolved ?? undefined });
            return asJson({ ok: true, proposalId, command: result.command, changedFiles: bumpChangedFiles(spec), resolvedVersion: resolved ?? spec.toVersion, output: result.output.slice(-2000) });
          } catch (err) {
            await revert(spec);
            const message = err instanceof Error ? err.message : String(err);
            updateProposal(p.id, { status: "failed", error: message.slice(0, 2000) });
            if (err instanceof ToolchainMissingError) return asJson({ ok: false, proposalId, reason: "toolchain-missing", tool: err.tool });
            return asError(message);
          }
        },
      ),

      tool(
        "run_install",
        "Install dependencies from the regenerated lockfile (scripts disabled) so tests run against the new tree.",
        { proposalId: z.string().uuid() },
        async ({ proposalId }) => {
          const denied = requireWritable();
          if (denied) return asError(denied);
          const p = getProposal(proposalId);
          if (!p || p.scan_id !== ctx.scanId) return asError("proposal not found in this run");
          if (p.status !== "applied") return asError(`proposal is ${p.status}; run_install expects "applied"`);
          const spec = proposalToSpec(p);
          try {
            const result = await runInstall(ctx.repoDir, spec);
            if (!result.ok) {
              await revert(spec);
              updateProposal(p.id, { status: "failed", error: result.output.slice(0, 2000) });
              return asJson({ ok: false, proposalId, command: result.command, output: result.output });
            }
            updateProposal(p.id, { status: "installed" });
            return asJson({ ok: true, proposalId, command: result.command, durationMs: result.durationMs });
          } catch (err) {
            await revert(spec);
            const message = err instanceof Error ? err.message : String(err);
            updateProposal(p.id, { status: "failed", error: message.slice(0, 2000) });
            if (err instanceof ToolchainMissingError) return asJson({ ok: false, proposalId, reason: "toolchain-missing", tool: err.tool });
            return asError(message);
          }
        },
      ),

      tool(
        "run_tests",
        "Run the project's own test script (default) or build/typecheck for a proposal. Failure reverts the bump.",
        {
          proposalId: z.string().uuid(),
          suite: z.enum(["default", "typecheck"]).default("default"),
          timeoutSec: z.number().int().min(30).max(1800).default(600),
        },
        async ({ proposalId, suite, timeoutSec }) => {
          const denied = requireWritable();
          if (denied) return asError(denied);
          const p = getProposal(proposalId);
          if (!p || p.scan_id !== ctx.scanId) return asError("proposal not found in this run");
          if (p.status !== "installed" && p.status !== "tested") return asError(`proposal is ${p.status}; run_tests expects "installed"`);
          const spec = proposalToSpec(p);
          try {
            const result = await runTests(ctx.repoDir, spec, suite, timeoutSec * 1000);
            if (!result.ok) {
              await revert(spec);
              updateProposal(p.id, { status: "test-failed", testSummary: `${suite}: FAILED (${result.command})`, error: result.output.slice(0, 2000) });
              return asJson({ ok: false, proposalId, suite, command: result.command, output: result.output });
            }
            const summary = result.skipped ? `${suite}: skipped (${result.skipped})` : `${suite}: passed (${result.command}, ${Math.round(result.durationMs / 1000)}s)`;
            const prev = p.test_summary ? `${p.test_summary}; ` : "";
            updateProposal(p.id, { status: "tested", testSummary: `${prev}${summary}` });
            return asJson({ ok: true, proposalId, suite, skipped: result.skipped ?? null, command: result.command, durationMs: result.durationMs });
          } catch (err) {
            await revert(spec);
            const message = err instanceof Error ? err.message : String(err);
            updateProposal(p.id, { status: "failed", error: message.slice(0, 2000) });
            if (err instanceof ToolchainMissingError) return asJson({ ok: false, proposalId, reason: "toolchain-missing", tool: err.tool });
            return asError(message);
          }
        },
      ),

      tool(
        "open_pr",
        "Commit the tested proposals for ONE manifest, push a defender/ branch and open a pull request for human review. Returns the PR URL.",
        {
          proposalIds: z.array(z.string().uuid()).min(1).max(10),
          summary: z.string().min(1).max(2000),
        },
        async ({ proposalIds, summary }) => {
          const denied = requireWritable();
          if (denied) return asError(denied);
          const proposals = proposalIds.map((id) => getProposal(id));
          if (proposals.some((p) => !p || p.scan_id !== ctx.scanId)) return asError("one or more proposals are not part of this run");
          const list = proposals as Proposal[];
          const notTested = list.filter((p) => p.status !== "tested");
          if (notTested.length) return asError(`proposals must be in status "tested": ${notTested.map((p) => `${p.id}=${p.status}`).join(", ")}`);
          const manifests = new Set(list.map((p) => p.manifest_path));
          if (manifests.size !== 1) return asError("open_pr accepts proposals for exactly one manifest at a time");
          const manifestPath = list[0].manifest_path;
          const slug = list
            .map((p) => p.package.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase())
            .slice(0, 3)
            .join("-")
            .slice(0, 40);
          const branch = `defender/${ctx.runId.slice(0, 8)}-${slug || "deps"}`;
          const files = Array.from(new Set(list.flatMap((p) => [p.manifest_path, p.lockfile_path])));
          const findings = list.map((p) => getFinding(p.finding_id)).filter((f): f is NonNullable<typeof f> => Boolean(f));
          const title = buildPrTitle(list, manifestPath);
          const body = buildPrBody({ proposals: list, findings, summary, manifestPath, runId: ctx.runId, scanId: ctx.scanId });
          try {
            await checkoutNewBranch(ctx.repoDir, branch);
            const sha = await commitFiles(ctx.repoDir, files, title);
            await pushBranch(ctx.repoDir, branch, ctx.githubToken!);
            const pr = await openPullRequest({
              repo: ctx.repo!,
              token: ctx.githubToken!,
              head: branch,
              base: ctx.defaultBranch ?? "main",
              title,
              body,
            });
            for (const p of list) {
              updateProposal(p.id, { status: "pr-opened", prUrl: pr.url });
              setFindingPrUrl(p.finding_id, pr.url);
            }
            log(`opened PR ${pr.url} (${branch} @ ${sha.slice(0, 8)})`);
            return asJson({ ok: true, url: pr.url, number: pr.number, branch, commit: sha, bumps: list.length });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            for (const p of list) updateProposal(p.id, { status: "failed", error: message.slice(0, 2000) });
            return asError(`open_pr failed: ${message}`);
          }
        },
      ),
    ],
  });
}

/** Highest version of `pkg` now pinned in the lockfile, or null if it cannot be read. */
function resolvedLockedVersion(repoDir: string, lockfilePath: string, pkg: string): string | null {
  try {
    const ref = discoverLockfiles(repoDir).find((r) => r.path === lockfilePath);
    if (!ref) return null;
    const versions = parseLockfile(repoDir, ref)
      .packages.filter((p) => p.name === pkg)
      .map((p) => p.version)
      .sort((a, b) => (versionGte(a, b) ? -1 : 1));
    return versions[0] ?? null;
  } catch {
    return null;
  }
}

/** Tool names exposed to the triage agent (read-only). */
export const DEFENDER_TRIAGE_TOOLS = [
  "mcp__defender__list_lockfiles",
  "mcp__defender__parse_lockfile",
  "mcp__defender__get_advisory",
  "mcp__defender__list_findings",
  "mcp__defender__annotate_finding",
  "mcp__defender__annotate_package",
] as const;

/** Tool names exposed to the patch agent. */
export const DEFENDER_PATCH_TOOLS = [
  "mcp__defender__list_findings",
  "mcp__defender__propose_bump",
  "mcp__defender__apply_bump",
  "mcp__defender__run_install",
  "mcp__defender__run_tests",
  "mcp__defender__open_pr",
] as const;

/** Read a manifest for display in the PR body; never used for secrets. */
export function readManifestSnippet(repoDir: string, manifestPath: string): string {
  try {
    return readFileSync(resolveInside(repoDir, manifestPath), "utf-8").slice(0, 400);
  } catch {
    return "";
  }
}
