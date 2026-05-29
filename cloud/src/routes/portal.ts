/**
 * Web portal HTML routes — server-rendered pages with access control
 */
import { Hono } from "hono";
import type { Env, Variables } from "../worker";
import { dashboardPage } from "../pages/dashboard";
import { projectPage } from "../pages/project";
import { documentPage } from "../pages/document";
import { downloadDoc } from "../gcs";
import { resolveProjectAccess } from "../lib/access";

const portal = new Hono<{ Bindings: Env; Variables: Variables }>();

// Dashboard — list projects (member + internal/public)
portal.get("/", async (c) => {
  const user = c.get("user");
  if (!user.id) return c.html(dashboardPage(user, []));

  const isOrgUser = user.email.endsWith("@sahamati.org.in");

  // Projects the user is an explicit member of
  const memberProjects = await c.env.DB.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM project_members WHERE project_id = p.id) AS member_count,
      (SELECT COUNT(*) FROM project_phases WHERE project_id = p.id) AS phase_count,
      (SELECT COUNT(*) FROM documents WHERE project_id = p.id) AS doc_count,
      pm.role AS user_role
    FROM projects p
    INNER JOIN project_members pm ON pm.project_id = p.id
    WHERE pm.user_id = ? AND p.status != 'archived'
    ORDER BY p.updated_at DESC
  `).bind(user.id).all();

  // Internal projects (visible to all org users) that user is NOT already a member of
  let internalProjects = { results: [] as Record<string, unknown>[] };
  if (isOrgUser) {
    internalProjects = await c.env.DB.prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM project_members WHERE project_id = p.id) AS member_count,
        (SELECT COUNT(*) FROM project_phases WHERE project_id = p.id) AS phase_count,
        (SELECT COUNT(*) FROM documents WHERE project_id = p.id) AS doc_count,
        NULL AS user_role
      FROM projects p
      WHERE p.visibility = 'internal' AND p.status != 'archived'
        AND p.id NOT IN (SELECT project_id FROM project_members WHERE user_id = ?)
      ORDER BY p.updated_at DESC
    `).bind(user.id).all();
  }

  // Public projects user is NOT a member of
  const publicProjects = await c.env.DB.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM project_members WHERE project_id = p.id) AS member_count,
      (SELECT COUNT(*) FROM project_phases WHERE project_id = p.id) AS phase_count,
      (SELECT COUNT(*) FROM documents WHERE project_id = p.id) AS doc_count,
      NULL AS user_role
    FROM projects p
    WHERE p.visibility = 'public' AND p.status != 'archived'
      AND p.id NOT IN (SELECT project_id FROM project_members WHERE user_id = ?)
    ORDER BY p.updated_at DESC
  `).bind(user.id).all();

  const allProjects = [
    ...memberProjects.results,
    ...internalProjects.results,
    ...publicProjects.results,
  ];

  return c.html(dashboardPage(user, allProjects));
});

// Project detail
portal.get("/projects/:slug", async (c) => {
  const slug = c.req.param("slug");
  const user = c.get("user");
  if (!user.id) return c.redirect("/portal");

  const access = await resolveProjectAccess(c.env.DB, slug, user.id, user.email);
  if (!access || !access.permissions.canView) return c.redirect("/portal");

  const projectId = String(access.project.id);

  const [phases, documents, members] = await Promise.all([
    c.env.DB.prepare(`
      SELECT pp.*,
        (SELECT COUNT(*) FROM documents WHERE phase_id = pp.id) AS doc_count
      FROM project_phases pp
      WHERE pp.project_id = ?
      ORDER BY pp.display_order
    `).bind(projectId).all(),

    c.env.DB.prepare(`
      SELECT d.*, pp.name AS phase_name, pp.display_order AS phase_order
      FROM documents d
      LEFT JOIN project_phases pp ON pp.id = d.phase_id
      WHERE d.project_id = ?
      ORDER BY pp.display_order, d.title
    `).bind(projectId).all(),

    c.env.DB.prepare(`
      SELECT pm.*, u.email, u.name, u.picture
      FROM project_members pm
      LEFT JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = ?
    `).bind(projectId).all(),
  ]);

  return c.html(
    projectPage(
      user,
      access.project,
      phases.results,
      documents.results,
      members.results,
      access.permissions
    )
  );
});

// Document viewer
portal.get("/projects/:slug/docs/:docId", async (c) => {
  const slug = c.req.param("slug");
  const docId = c.req.param("docId");
  const user = c.get("user");
  if (!user.id) return c.redirect("/portal");

  const access = await resolveProjectAccess(c.env.DB, slug, user.id, user.email);
  if (!access || !access.permissions.canView) return c.redirect("/portal");

  const projectId = String(access.project.id);

  const doc = await c.env.DB.prepare(
    "SELECT d.*, pp.name AS phase_name FROM documents d LEFT JOIN project_phases pp ON pp.id = d.phase_id WHERE d.id = ? AND d.project_id = ?"
  ).bind(docId, projectId).first();

  if (!doc) return c.redirect(`/portal/projects/${slug}`);

  const docRecord = doc as Record<string, unknown>;
  if (c.env.GCS_SERVICE_ACCOUNT_KEY && c.env.GCS_BUCKET) {
    const content = await downloadDoc(c.env.GCS_SERVICE_ACCOUNT_KEY, c.env.GCS_BUCKET, slug, docId);
    if (content) docRecord.content = content;
  }

  return c.html(
    documentPage(user, access.project, docRecord)
  );
});

export { portal as portalRoutes };
