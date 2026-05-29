/**
 * D1-aware access control helpers.
 * Wraps the permission model with actual database queries.
 */
import type { ProjectRole, ProjectVisibility, Permission } from "./permissions";
import { resolvePermissions } from "./permissions";

export interface UserInfo {
  id: string;
  email: string;
  name: string;
  picture: string;
  role: string; // global role (admin/member)
}

/**
 * Look up the authenticated user's DB record by email.
 * Returns null if the user hasn't been synced/created yet.
 */
export async function getUserByEmail(db: D1Database, email: string): Promise<UserInfo | null> {
  return db.prepare("SELECT id, email, name, picture, role FROM users WHERE email = ?")
    .bind(email)
    .first<UserInfo>();
}

/**
 * Get user's role in a specific project. Returns null if not a member.
 */
export async function getMemberRole(
  db: D1Database,
  projectId: string,
  userId: string
): Promise<ProjectRole | null> {
  const row = await db
    .prepare("SELECT role FROM project_members WHERE project_id = ? AND user_id = ?")
    .bind(projectId, userId)
    .first<{ role: string }>();
  return (row?.role as ProjectRole) ?? null;
}

/**
 * Get a project by slug, returning it with visibility info.
 */
export async function getProjectBySlug(
  db: D1Database,
  slug: string
): Promise<Record<string, unknown> | null> {
  return db.prepare("SELECT * FROM projects WHERE slug = ?")
    .bind(slug)
    .first();
}

/**
 * Resolve full permissions for a user on a project (by slug).
 * Returns { project, permissions } or null if project doesn't exist.
 */
export async function resolveProjectAccess(
  db: D1Database,
  slug: string,
  userId: string,
  userEmail: string
): Promise<{ project: Record<string, unknown>; permissions: Permission } | null> {
  const project = await getProjectBySlug(db, slug);
  if (!project) return null;

  const memberRole = await getMemberRole(db, String(project.id), userId);
  const visibility = (String(project.visibility || "private")) as ProjectVisibility;
  const isOrgUser = userEmail.endsWith("@sahamati.org.in");

  const permissions = resolvePermissions(memberRole, visibility, isOrgUser);
  return { project, permissions };
}
