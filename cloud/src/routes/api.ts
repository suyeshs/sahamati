/**
 * Portal JSON API — D1 queries with granular access control
 */
import { Hono } from "hono";
import type { Env, Variables } from "../worker";
import { downloadDoc } from "../gcs";
import { resolveProjectAccess, getUserByEmail } from "../lib/access";
import { isValidRole, isValidVisibility, canManageRole, assignableRoles } from "../lib/permissions";
import type { ProjectRole } from "../lib/permissions";

const api = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Accept https://github.com/owner/repo[.git], git@github.com:owner/repo[.git],
 * or "owner/repo". Reject anything else. Returns canonicalised
 * https://github.com/owner/repo or null when invalid.
 */
function normalizeGithubUrl(input: string): string | null {
  const m = input.match(/^(?:https?:\/\/github\.com\/|git@github\.com:|)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  if (!m) return null;
  const [, owner, repo] = m;
  if (!owner || !repo || owner === "." || owner === ".." || repo === "." || repo === "..") return null;
  return `https://github.com/${owner}/${repo}`;
}

// ─── Users ───────────────────────────────────────────────────────────

// List all registered users (for "add member" picker)
api.get("/users", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, email, name, picture FROM users ORDER BY name"
  ).all();
  return c.json({ users: results });
});

// Current user info
api.get("/me", (c) => {
  const user = c.get("user");
  return c.json({ user });
});

// ─── Projects ────────────────────────────────────────────────────────

// List projects the user can see
api.get("/projects", async (c) => {
  const user = c.get("user");
  if (!user.id) return c.json({ projects: [] });

  const isOrgUser = user.email.endsWith("@sahamati.org.in");

  // Member projects
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

  // Internal projects (org users only)
  let internalResults: Record<string, unknown>[] = [];
  if (isOrgUser) {
    const q = await c.env.DB.prepare(`
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
    internalResults = q.results;
  }

  // Public projects
  const publicQ = await c.env.DB.prepare(`
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

  return c.json({
    projects: [
      ...memberProjects.results,
      ...internalResults,
      ...publicQ.results,
    ],
  });
});

// Get single project with phases and members
api.get("/projects/:slug", async (c) => {
  const slug = c.req.param("slug");
  const user = c.get("user");
  if (!user.id) return c.json({ error: "User not found" }, 404);

  const access = await resolveProjectAccess(c.env.DB, slug, user.id, user.email);
  if (!access || !access.permissions.canView) {
    return c.json({ error: "Project not found" }, 404);
  }

  const projectId = String(access.project.id);

  const [phases, members] = await Promise.all([
    c.env.DB.prepare(`
      SELECT pp.*,
        (SELECT COUNT(*) FROM documents WHERE phase_id = pp.id) AS doc_count
      FROM project_phases pp
      WHERE pp.project_id = ?
      ORDER BY pp.display_order
    `).bind(projectId).all(),

    c.env.DB.prepare(`
      SELECT pm.*, u.email, u.name, u.picture
      FROM project_members pm
      LEFT JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = ?
    `).bind(projectId).all(),
  ]);

  return c.json({
    project: access.project,
    phases: phases.results,
    members: members.results,
    permissions: access.permissions,
  });
});

// Update project settings (name, description, visibility)
api.patch("/projects/:slug", async (c) => {
  const slug = c.req.param("slug");
  const user = c.get("user");
  if (!user.id) return c.json({ error: "Unauthorized" }, 401);

  const access = await resolveProjectAccess(c.env.DB, slug, user.id, user.email);
  if (!access || !access.permissions.canManageSettings) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const body = await c.req.json() as Record<string, unknown>;
  const updates: string[] = [];
  const params: unknown[] = [];

  if (typeof body.name === "string" && body.name.trim()) {
    updates.push("name = ?");
    params.push(body.name.trim());
  }
  if (typeof body.description === "string") {
    updates.push("description = ?");
    params.push(body.description.trim());
  }
  if (typeof body.visibility === "string" && isValidVisibility(body.visibility)) {
    updates.push("visibility = ?");
    params.push(body.visibility);
  }
  if (body.github_repo_url !== undefined) {
    const raw = typeof body.github_repo_url === "string" ? body.github_repo_url.trim() : "";
    if (raw === "") {
      updates.push("github_repo_url = ?");
      params.push(null);
    } else {
      const normalized = normalizeGithubUrl(raw);
      if (!normalized) {
        return c.json({ error: "Invalid GitHub URL — expected https://github.com/owner/repo or git@github.com:owner/repo" }, 400);
      }
      updates.push("github_repo_url = ?");
      params.push(normalized);
    }
  }

  if (updates.length === 0) return c.json({ error: "No valid fields to update" }, 400);

  updates.push("updated_at = ?");
  params.push(new Date().toISOString());
  params.push(String(access.project.id));

  const projectId = String(access.project.id);

  // Fetch current project data before update for sync log
  const currentProject = await c.env.DB.prepare("SELECT * FROM projects WHERE id = ?")
    .bind(projectId).first();

  await c.env.DB.prepare(
    `UPDATE projects SET ${updates.join(", ")} WHERE id = ?`
  ).bind(...params).run();

  // Fetch updated project for sync log
  const updatedProject = await c.env.DB.prepare("SELECT * FROM projects WHERE id = ?")
    .bind(projectId).first();

  if (updatedProject) {
    const syncNow = new Date().toISOString();
    await c.env.DB.prepare(
      `INSERT INTO _sync_log (table_name, record_id, operation, data, timestamp, device_id)
       VALUES ('projects', ?, 'UPDATE', ?, ?, 'cloud')`
    ).bind(projectId, JSON.stringify(updatedProject), syncNow).run();
  }

  return c.json({ success: true });
});

// ─── Documents ───────────────────────────────────────────────────────

api.get("/projects/:slug/documents", async (c) => {
  const slug = c.req.param("slug");
  const phaseId = c.req.query("phaseId");
  const user = c.get("user");
  if (!user.id) return c.json({ error: "User not found" }, 404);

  const access = await resolveProjectAccess(c.env.DB, slug, user.id, user.email);
  if (!access || !access.permissions.canView) {
    return c.json({ error: "Project not found" }, 404);
  }

  let query = `
    SELECT d.*, pp.name AS phase_name, pp.display_order AS phase_order
    FROM documents d
    LEFT JOIN project_phases pp ON pp.id = d.phase_id
    WHERE d.project_id = ?
  `;
  const params: unknown[] = [String(access.project.id)];

  if (phaseId) {
    query += ` AND d.phase_id = ?`;
    params.push(phaseId);
  }

  query += ` ORDER BY pp.display_order, d.title`;

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ documents: results });
});

api.get("/projects/:slug/documents/:docId", async (c) => {
  const slug = c.req.param("slug");
  const docId = c.req.param("docId");
  const user = c.get("user");
  if (!user.id) return c.json({ error: "User not found" }, 404);

  const access = await resolveProjectAccess(c.env.DB, slug, user.id, user.email);
  if (!access || !access.permissions.canView) {
    return c.json({ error: "Project not found" }, 404);
  }

  const doc = await c.env.DB.prepare(
    "SELECT * FROM documents WHERE id = ? AND project_id = ?"
  ).bind(docId, String(access.project.id)).first();

  if (!doc) return c.json({ error: "Document not found" }, 404);

  let content = "";
  if (c.env.GCS_SERVICE_ACCOUNT_KEY && c.env.GCS_BUCKET) {
    content = (await downloadDoc(c.env.GCS_SERVICE_ACCOUNT_KEY, c.env.GCS_BUCKET, slug, docId)) || "";
  }

  return c.json({ document: doc, content });
});

// ─── Members ─────────────────────────────────────────────────────────

// List members of a project
api.get("/projects/:slug/members", async (c) => {
  const slug = c.req.param("slug");
  const user = c.get("user");
  if (!user.id) return c.json({ error: "Unauthorized" }, 401);

  const access = await resolveProjectAccess(c.env.DB, slug, user.id, user.email);
  if (!access || !access.permissions.canView) {
    return c.json({ error: "Project not found" }, 404);
  }

  const { results } = await c.env.DB.prepare(`
    SELECT pm.role, pm.added_at, u.id, u.email, u.name, u.picture
    FROM project_members pm
    LEFT JOIN users u ON u.id = pm.user_id
    WHERE pm.project_id = ?
    ORDER BY
      CASE pm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END,
      u.name
  `).bind(String(access.project.id)).all();

  return c.json({
    members: results,
    permissions: access.permissions,
    assignableRoles: access.permissions.canManageMembers
      ? assignableRoles(access.permissions.role!)
      : [],
  });
});

// Add a member to a project
api.post("/projects/:slug/members", async (c) => {
  const slug = c.req.param("slug");
  const user = c.get("user");
  if (!user.id) return c.json({ error: "Unauthorized" }, 401);

  const access = await resolveProjectAccess(c.env.DB, slug, user.id, user.email);
  if (!access || !access.permissions.canManageMembers) {
    return c.json({ error: "Forbidden — you cannot manage members on this project" }, 403);
  }

  const body = await c.req.json() as { userId: string; role?: string };
  if (!body.userId) return c.json({ error: "userId is required" }, 400);

  const role = (body.role || "viewer") as ProjectRole;
  if (!isValidRole(role)) return c.json({ error: "Invalid role" }, 400);

  // Can the actor assign this role?
  if (!canManageRole(access.permissions.role!, role)) {
    return c.json({ error: `You cannot assign the '${role}' role` }, 403);
  }

  // Check target user exists
  const targetUser = await c.env.DB.prepare("SELECT id FROM users WHERE id = ?")
    .bind(body.userId).first<{ id: string }>();
  if (!targetUser) return c.json({ error: "User not found" }, 404);

  // Check not already a member
  const existing = await c.env.DB.prepare(
    "SELECT role FROM project_members WHERE project_id = ? AND user_id = ?"
  ).bind(String(access.project.id), body.userId).first();
  if (existing) return c.json({ error: "User is already a member" }, 409);

  const projectId = String(access.project.id);
  const addedAt = new Date().toISOString();

  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO project_members (project_id, user_id, role, added_at) VALUES (?, ?, ?, ?)"
    ).bind(projectId, body.userId, role, addedAt),

    // Record in sync log so desktop apps pick up the membership
    c.env.DB.prepare(
      `INSERT INTO _sync_log (table_name, record_id, operation, data, timestamp, device_id)
       VALUES ('project_members', ?, 'INSERT', ?, ?, 'cloud')`
    ).bind(
      `${projectId}:${body.userId}`,
      JSON.stringify({ project_id: projectId, user_id: body.userId, role, added_at: addedAt }),
      addedAt
    ),
  ]);

  return c.json({ success: true, role });
});

// Update a member's role
api.patch("/projects/:slug/members/:userId", async (c) => {
  const slug = c.req.param("slug");
  const targetUserId = c.req.param("userId");
  const user = c.get("user");
  if (!user.id) return c.json({ error: "Unauthorized" }, 401);

  const access = await resolveProjectAccess(c.env.DB, slug, user.id, user.email);
  if (!access || !access.permissions.canManageMembers) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const body = await c.req.json() as { role: string };
  if (!body.role || !isValidRole(body.role)) {
    return c.json({ error: "Invalid role" }, 400);
  }

  const newRole = body.role as ProjectRole;
  const projectId = String(access.project.id);

  // Get target's current role
  const target = await c.env.DB.prepare(
    "SELECT role FROM project_members WHERE project_id = ? AND user_id = ?"
  ).bind(projectId, targetUserId).first<{ role: string }>();

  if (!target) return c.json({ error: "Member not found" }, 404);

  // Can the actor change this member's role?
  if (!canManageRole(access.permissions.role!, target.role as ProjectRole)) {
    return c.json({ error: "You cannot modify this member's role" }, 403);
  }
  if (!canManageRole(access.permissions.role!, newRole)) {
    return c.json({ error: `You cannot assign the '${newRole}' role` }, 403);
  }

  const now = new Date().toISOString();

  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?"
    ).bind(newRole, projectId, targetUserId),

    c.env.DB.prepare(
      `INSERT INTO _sync_log (table_name, record_id, operation, data, timestamp, device_id)
       VALUES ('project_members', ?, 'UPDATE', ?, ?, 'cloud')`
    ).bind(
      `${projectId}:${targetUserId}`,
      JSON.stringify({ project_id: projectId, user_id: targetUserId, role: newRole, added_at: now }),
      now
    ),
  ]);

  return c.json({ success: true, role: newRole });
});

// Remove a member from a project
api.delete("/projects/:slug/members/:userId", async (c) => {
  const slug = c.req.param("slug");
  const targetUserId = c.req.param("userId");
  const user = c.get("user");
  if (!user.id) return c.json({ error: "Unauthorized" }, 401);

  const access = await resolveProjectAccess(c.env.DB, slug, user.id, user.email);
  if (!access) return c.json({ error: "Project not found" }, 404);

  const projectId = String(access.project.id);

  // Allow self-removal (leaving the project)
  if (targetUserId === user.id) {
    // Owners can't leave — must transfer ownership first
    if (access.permissions.role === "owner") {
      return c.json({ error: "Owners cannot leave. Transfer ownership first." }, 403);
    }
    const selfNow = new Date().toISOString();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "DELETE FROM project_members WHERE project_id = ? AND user_id = ?"
      ).bind(projectId, targetUserId),
      c.env.DB.prepare(
        `INSERT INTO _sync_log (table_name, record_id, operation, data, timestamp, device_id)
         VALUES ('project_members', ?, 'DELETE', ?, ?, 'cloud')`
      ).bind(
        `${projectId}:${targetUserId}`,
        JSON.stringify({ project_id: projectId, user_id: targetUserId }),
        selfNow
      ),
    ]);
    return c.json({ success: true });
  }

  // Removing someone else — need manage permission
  if (!access.permissions.canManageMembers) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const target = await c.env.DB.prepare(
    "SELECT role FROM project_members WHERE project_id = ? AND user_id = ?"
  ).bind(projectId, targetUserId).first<{ role: string }>();

  if (!target) return c.json({ error: "Member not found" }, 404);

  if (!canManageRole(access.permissions.role!, target.role as ProjectRole)) {
    return c.json({ error: "You cannot remove this member" }, 403);
  }

  const removeNow = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM project_members WHERE project_id = ? AND user_id = ?"
    ).bind(projectId, targetUserId),
    c.env.DB.prepare(
      `INSERT INTO _sync_log (table_name, record_id, operation, data, timestamp, device_id)
       VALUES ('project_members', ?, 'DELETE', ?, ?, 'cloud')`
    ).bind(
      `${projectId}:${targetUserId}`,
      JSON.stringify({ project_id: projectId, user_id: targetUserId }),
      removeNow
    ),
  ]);

  return c.json({ success: true });
});

export { api as apiRoutes };
