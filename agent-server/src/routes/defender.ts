// Defender HTTP surface. Reads need project membership; anything that creates,
// approves, scans or patches needs the global admin role (these actions reach
// out to GitHub and spend model credits).

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { AppEnv } from "../types.js";
import { authMiddleware } from "../middleware/auth-middleware.js";
import { requireAdmin, checkPermission } from "../middleware/rbac-middleware.js";
import { getProjectBySlug, getProjectById, listAllProjects, listProjectsForUser } from "../db/repositories/project-repo.js";
import { getMemberRole } from "../db/repositories/member-repo.js";
import { getGitHubToken } from "../auth/github-store.js";
import { approveTarget, deleteTarget, getTarget, listScans, updateFindingStatus } from "../db/repositories/scan-repo.js";
import {
  createDependencyTarget,
  listDependencyTargets,
  listLatestFindings,
  updateTargetSchedule,
  listProposals,
  loadPostureRows,
  listAlerts,
  acknowledgeAlert,
  DEPENDENCY_PROFILE,
} from "../db/repositories/defender-repo.js";
import { computePosture } from "../services/defender/posture.js";
import { runCveWatch, lastWatchRun, watchIsStale } from "../services/defender/cve-watch.js";
import { assertValidCron } from "../services/defender/cron.js";
import { parseGitHubRepo, isFileTarget, fileTargetPath } from "../services/defender/git.js";
import { executeScan, executePatch, isInFlight, InFlightError, TargetNotApprovedError } from "../services/defender/service.js";
import { sdkCredentialsAvailable } from "../services/defender/run-agent.js";
import { existsSync } from "node:fs";

const defender = new Hono<AppEnv>();

defender.use("/api/defender/*", authMiddleware);

// --- helpers ---------------------------------------------------------------

function canView(c: Parameters<typeof requireAdmin>[0], projectId: string): boolean {
  const role = c.get("userRole");
  if (role === "admin") return true;
  const project = getProjectById(projectId);
  if (!project) return false;
  const memberRole = getMemberRole(projectId, c.get("userId")) ?? (project.created_by === c.get("userId") ? "owner" : undefined);
  return checkPermission(memberRole, role, "view-project");
}

function targetOr404(c: Parameters<typeof requireAdmin>[0], id: string) {
  const t = getTarget(id);
  if (!t || t.scan_profile !== DEPENDENCY_PROFILE) return null;
  return t;
}

function errorStatus(err: unknown): 400 | 403 | 409 | 503 {
  if (err instanceof InFlightError) return 409;
  if (err instanceof TargetNotApprovedError) return 403;
  if (err instanceof Error && /ANTHROPIC_API_KEY/.test(err.message)) return 503;
  return 400;
}

const CreateTarget = z.object({
  projectSlug: z.string().min(1),
  label: z.string().min(1).max(120),
  repoUrl: z.string().min(1).max(512),
  scheduleCron: z.string().min(9).max(64).optional(),
});

// --- targets ---------------------------------------------------------------

defender.get("/api/defender/targets", (c) => {
  const slug = c.req.query("project");
  if (!slug) return c.json({ error: "project query parameter is required" }, 400);
  const project = getProjectBySlug(slug);
  if (!project) return c.json({ error: "project not found" }, 404);
  if (!canView(c, project.id)) return c.json({ error: "forbidden" }, 403);
  const targets = listDependencyTargets(project.id).map((t) => ({ ...t, in_flight: isInFlight(t.id) }));
  return c.json({ targets });
});

defender.post("/api/defender/targets", async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;
  const parsed = CreateTarget.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid body", issues: parsed.error.issues }, 400);
  const { projectSlug, label, repoUrl, scheduleCron } = parsed.data;
  const project = getProjectBySlug(projectSlug);
  if (!project) return c.json({ error: "project not found" }, 404);

  let normalizedUrl: string;
  if (isFileTarget(repoUrl)) {
    if (!existsSync(fileTargetPath(repoUrl))) return c.json({ error: "file:// path does not exist on the agent-server host" }, 400);
    normalizedUrl = repoUrl;
  } else {
    try {
      const r = parseGitHubRepo(repoUrl);
      normalizedUrl = `https://github.com/${r.owner}/${r.name}`;
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  }
  if (scheduleCron) {
    try {
      assertValidCron(scheduleCron);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  }
  const target = createDependencyTarget({ projectId: project.id, label, repoUrl: normalizedUrl, scheduleCron, createdBy: c.get("userId") });
  return c.json({ target }, 201);
});

defender.post("/api/defender/targets/:id/approve", async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;
  const t = targetOr404(c, c.req.param("id"));
  if (!t) return c.json({ error: "target not found" }, 404);
  const body = z.object({ reason: z.string().min(1).max(500) }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "reason is required" }, 400);
  const target = approveTarget({ targetId: t.id, approvedBy: c.get("userId"), approvalReason: body.data.reason });
  return c.json({ target });
});

defender.patch("/api/defender/targets/:id", async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;
  const t = targetOr404(c, c.req.param("id"));
  if (!t) return c.json({ error: "target not found" }, 404);
  const body = z.object({ scheduleCron: z.string().min(9).max(64).nullable() }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "scheduleCron (string or null) is required" }, 400);
  if (body.data.scheduleCron) {
    try {
      assertValidCron(body.data.scheduleCron);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  }
  return c.json({ target: updateTargetSchedule(t.id, body.data.scheduleCron) });
});

defender.delete("/api/defender/targets/:id", (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;
  const t = targetOr404(c, c.req.param("id"));
  if (!t) return c.json({ error: "target not found" }, 404);
  if (isInFlight(t.id)) return c.json({ error: "a run is in progress for this target" }, 409);
  deleteTarget(t.id);
  return c.json({ ok: true });
});

// --- runs ------------------------------------------------------------------

defender.post("/api/defender/scan/:id", async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;
  const t = targetOr404(c, c.req.param("id"));
  if (!t) return c.json({ error: "target not found" }, 404);
  const body = z.object({ phase: z.enum(["scan", "scan+triage"]).default("scan") }).safeParse((await c.req.json().catch(() => ({}))) ?? {});
  if (!body.success) return c.json({ error: "invalid body" }, 400);
  if (!t.approved_at) return c.json({ error: "target is not approved" }, 403);
  if (isInFlight(t.id)) return c.json({ error: "a run is already in progress for this target" }, 409);
  if (body.data.phase === "scan+triage" && !sdkCredentialsAvailable()) {
    return c.json({ error: "triage needs ANTHROPIC_API_KEY on the agent-server; run with phase \"scan\" instead" }, 503);
  }
  const userEmail = c.get("userEmail");
  const githubToken = userEmail ? getGitHubToken(userEmail)?.accessToken : undefined;

  return streamSSE(c, async (stream) => {
    let id = 0;
    const send = (event: string, data: unknown) => stream.writeSSE({ id: String(id++), event, data: JSON.stringify(data) });
    try {
      const result = await executeScan(t.id, {
        trigger: "manual",
        triggeredBy: c.get("userId"),
        phase: body.data.phase,
        githubToken,
        onMessage: (m) => send("message", m),
      });
      await send("done", {
        status: "completed",
        scanId: result.scan.id,
        findings: result.findings.length,
        added: result.diff.added.length,
        resolved: result.diff.resolved.length,
        triaged: result.triaged,
      });
    } catch (err) {
      await send("error", { error: err instanceof Error ? err.message : String(err), status: errorStatus(err) });
    }
  });
});

defender.post("/api/defender/patch/:id", async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;
  const t = targetOr404(c, c.req.param("id"));
  if (!t) return c.json({ error: "target not found" }, 404);
  const body = z.object({ findingIds: z.array(z.string().uuid()).min(1).max(25) }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "findingIds (1-25 uuids) is required" }, 400);
  if (!t.approved_at) return c.json({ error: "target is not approved" }, 403);
  if (isFileTarget(t.base_url)) return c.json({ error: "file:// targets are scan-only" }, 400);
  if (isInFlight(t.id)) return c.json({ error: "a run is already in progress for this target" }, 409);
  if (!sdkCredentialsAvailable()) return c.json({ error: "patching needs ANTHROPIC_API_KEY on the agent-server" }, 503);
  const userEmail = c.get("userEmail");
  const githubToken = userEmail ? getGitHubToken(userEmail)?.accessToken : undefined;
  if (!githubToken) return c.json({ error: "connect your GitHub account first; the patch agent pushes a branch and opens a PR with your token" }, 400);

  return streamSSE(c, async (stream) => {
    let id = 0;
    const send = (event: string, data: unknown) => stream.writeSSE({ id: String(id++), event, data: JSON.stringify(data) });
    try {
      const result = await executePatch(t.id, {
        findingIds: body.data.findingIds,
        githubToken,
        triggeredBy: c.get("userId"),
        onMessage: (m) => send("message", m),
      });
      const proposals = listProposals(result.scanId);
      await send("done", {
        status: "completed",
        scanId: result.scanId,
        proposals: proposals.map((p) => ({ id: p.id, package: p.package, to: p.to_version, status: p.status, prUrl: p.pr_url })),
      });
    } catch (err) {
      await send("error", { error: err instanceof Error ? err.message : String(err), status: errorStatus(err) });
    }
  });
});

// --- posture (cross-project, CISO view) -------------------------------------

// Admins and management see every project; everyone else sees the projects
// they belong to. Aggregate metrics only; no code, paths or advisories leave here.
defender.get("/api/defender/posture", (c) => {
  const role = c.get("userRole");
  const visible = role === "admin" || role === "management" ? listAllProjects() : listProjectsForUser(c.get("userId"));
  const projects = visible.filter((p) => p.status !== "archived").map((p) => ({ id: p.id, slug: p.slug, name: p.name }));
  const rows = loadPostureRows(projects.map((p) => p.id));
  return c.json(computePosture({ projects, ...rows }));
});

// --- CVE watch alerts -------------------------------------------------------

function visibleProjectIds(c: Parameters<typeof requireAdmin>[0]): string[] {
  const role = c.get("userRole");
  const visible = role === "admin" || role === "management" ? listAllProjects() : listProjectsForUser(c.get("userId"));
  return visible.filter((p) => p.status !== "archived").map((p) => p.id);
}

let watchInFlight: Promise<unknown> | null = null;
const WATCH_STALE_HOURS = Number(process.env.SAHAMATI_DEFENDER_CVE_WATCH_HOURS ?? 6);

defender.get("/api/defender/alerts", (c) => {
  const open = c.req.query("open") !== "0";
  const alerts = listAlerts(visibleProjectIds(c), { open }).map((a) => ({ ...a, aliases: a.aliases ? JSON.parse(a.aliases) : [] }));
  const last = lastWatchRun();
  return c.json({ alerts, lastCheckedAt: last.at, lastError: last.error, stale: watchIsStale(WATCH_STALE_HOURS), running: watchInFlight !== null });
});

// Any signed-in user may trigger a feed check: it reads public advisory data
// and writes alerts only. `ifStale` makes page loads cheap.
defender.post("/api/defender/cve-watch/run", async (c) => {
  const ifStale = c.req.query("ifStale") === "1";
  if (ifStale && !watchIsStale(WATCH_STALE_HOURS)) return c.json({ ran: false, reason: "fresh", lastCheckedAt: lastWatchRun().at });
  if (watchInFlight) {
    await watchInFlight.catch(() => undefined);
    return c.json({ ran: false, reason: "already-running", lastCheckedAt: lastWatchRun().at });
  }
  const run = runCveWatch({ log: (l) => console.log(`[cve-watch] ${l}`) });
  watchInFlight = run;
  try {
    const r = await run;
    return c.json({ ran: true, checkedTargets: r.checkedTargets, checkedPackages: r.checkedPackages, newAlerts: r.newAlerts.length, skipped: r.skipped, lastCheckedAt: r.ranAt });
  } catch (err) {
    return c.json({ ran: false, error: err instanceof Error ? err.message : String(err) }, 502);
  } finally {
    watchInFlight = null;
  }
});

defender.post("/api/defender/alerts/:id/ack", (c) => {
  const alert = acknowledgeAlert(c.req.param("id"), c.get("userId"));
  if (!alert) return c.json({ error: "alert not found or already acknowledged" }, 404);
  if (!visibleProjectIds(c).includes(alert.project_id)) return c.json({ error: "forbidden" }, 403);
  return c.json({ alert });
});

// --- results ---------------------------------------------------------------

defender.get("/api/defender/scans", (c) => {
  const targetId = c.req.query("targetId");
  if (!targetId) return c.json({ error: "targetId is required" }, 400);
  const t = targetOr404(c, targetId);
  if (!t) return c.json({ error: "target not found" }, 404);
  if (!canView(c, t.project_id)) return c.json({ error: "forbidden" }, 403);
  const scans = listScans(t.project_id, t.id).map((s) => ({ ...s, summary: s.summary ? JSON.parse(s.summary) : null }));
  return c.json({ scans });
});

defender.get("/api/defender/findings", (c) => {
  const targetId = c.req.query("targetId");
  if (!targetId) return c.json({ error: "targetId is required" }, 400);
  const t = targetOr404(c, targetId);
  if (!t) return c.json({ error: "target not found" }, 404);
  if (!canView(c, t.project_id)) return c.json({ error: "forbidden" }, 403);
  const status = c.req.query("status") as "open" | "resolved" | "accepted-risk" | "false-positive" | undefined;
  const { scan, findings } = listLatestFindings(t.id, status);
  return c.json({
    scan: scan ? { ...scan, summary: scan.summary ? JSON.parse(scan.summary) : null } : null,
    findings: findings.map((f) => ({ ...f, advisory_ids: f.advisory_ids ? JSON.parse(f.advisory_ids) : [], evidence: f.evidence ? JSON.parse(f.evidence) : null })),
  });
});

defender.patch("/api/defender/findings/:id", async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;
  const body = z.object({ status: z.enum(["open", "resolved", "accepted-risk", "false-positive"]) }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "status is required" }, 400);
  const row = updateFindingStatus(c.req.param("id"), body.data.status);
  if (!row) return c.json({ error: "finding not found" }, 404);
  return c.json({ finding: row });
});

export default defender;
