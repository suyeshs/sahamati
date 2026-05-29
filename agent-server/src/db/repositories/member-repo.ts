import { getDb } from "../index.js";
import type { User } from "./user-repo.js";
import { recordChange } from "../../sync/sync-engine.js";

export interface ProjectMember {
  project_id: string;
  user_id: string;
  role: string;
  added_at: string;
  // Joined fields
  email?: string;
  name?: string;
  picture?: string;
}

export function listMembers(projectId: string): ProjectMember[] {
  return getDb()
    .prepare(
      `SELECT pm.*, u.email, u.name, u.picture
      FROM project_members pm
      INNER JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = ?
      ORDER BY pm.role, u.name`
    )
    .all(projectId) as ProjectMember[];
}

export function addMember(
  projectId: string,
  userId: string,
  role: string = "member"
): void {
  const added_at = new Date().toISOString();
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO project_members (project_id, user_id, role, added_at) VALUES (?, ?, ?, ?)"
    )
    .run(projectId, userId, role, added_at);
  recordChange("project_members", `${projectId}:${userId}`, "INSERT", {
    project_id: projectId,
    user_id: userId,
    role,
    added_at,
  });
}

export function updateMemberRole(
  projectId: string,
  userId: string,
  role: string
): boolean {
  const result = getDb()
    .prepare(
      "UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?"
    )
    .run(role, projectId, userId);
  if (result.changes > 0) {
    const row = getDb()
      .prepare("SELECT * FROM project_members WHERE project_id = ? AND user_id = ?")
      .get(projectId, userId) as Record<string, unknown>;
    if (row) recordChange("project_members", `${projectId}:${userId}`, "UPDATE", row);
  }
  return result.changes > 0;
}

export function removeMember(projectId: string, userId: string): boolean {
  const result = getDb()
    .prepare(
      "DELETE FROM project_members WHERE project_id = ? AND user_id = ?"
    )
    .run(projectId, userId);
  if (result.changes > 0) {
    recordChange("project_members", `${projectId}:${userId}`, "DELETE", {
      project_id: projectId,
      user_id: userId,
    });
  }
  return result.changes > 0;
}

export function getMemberRole(
  projectId: string,
  userId: string
): string | undefined {
  const row = getDb()
    .prepare(
      "SELECT role FROM project_members WHERE project_id = ? AND user_id = ?"
    )
    .get(projectId, userId) as { role: string } | undefined;
  return row?.role;
}

export function isProjectMember(
  projectId: string,
  userId: string
): boolean {
  return getMemberRole(projectId, userId) !== undefined;
}
