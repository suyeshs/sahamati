import type { Context, Next } from "hono";
import { getMemberRole } from "../db/repositories/member-repo.js";
import { getProjectBySlug } from "../db/repositories/project-repo.js";
import type { AppEnv } from "../types.js";

type Action =
  | "view-project"
  | "edit-project"
  | "delete-project"
  | "add-members"
  | "run-agents"
  | "view-documents"
  | "manage-documents";

const PROJECT_ROLE_PERMISSIONS: Record<string, Set<Action>> = {
  owner: new Set([
    "view-project",
    "edit-project",
    "delete-project",
    "add-members",
    "run-agents",
    "view-documents",
    "manage-documents",
  ]),
  lead: new Set([
    "view-project",
    "edit-project",
    "add-members",
    "run-agents",
    "view-documents",
    "manage-documents",
  ]),
  member: new Set([
    "view-project",
    "run-agents",
    "view-documents",
    "manage-documents",
  ]),
  viewer: new Set(["view-project", "view-documents"]),
};

export function checkPermission(
  projectRole: string | undefined,
  globalRole: string,
  action: Action
): boolean {
  // Global admins can do everything
  if (globalRole === "admin") return true;

  if (!projectRole) return false;

  const allowed = PROJECT_ROLE_PERMISSIONS[projectRole];
  return allowed ? allowed.has(action) : false;
}

// Middleware factory that checks project-level permissions
export function requireProjectPermission(action: Action) {
  return async (c: Context<AppEnv>, next: Next) => {
    const slug = c.req.param("slug");
    const userId = c.get("userId");
    const userRole = c.get("userRole");

    if (!slug) {
      return c.json({ error: "Project slug required" }, 400);
    }

    const project = getProjectBySlug(slug);
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    // A project's creator is always its owner, even if their project_members
    // row is missing. Sync DELETE replays have dropped owner rows before; the
    // project list (listProjectsForUser) already falls back to created_by, so
    // mirror that here — otherwise the creator sees the project but is denied
    // every action against it.
    const memberRole =
      getMemberRole(project.id, userId) ??
      (project.created_by === userId ? "owner" : undefined);
    if (!checkPermission(memberRole, userRole, action)) {
      return c.json({ error: "Insufficient permissions" }, 403);
    }

    c.set("project", project);
    c.set("projectId", project.id);
    c.set("memberRole", memberRole);

    await next();
  };
}
