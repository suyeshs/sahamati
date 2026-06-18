import { randomUUID } from "crypto";
import { getDb } from "../index.js";
import { recordChange } from "../../sync/sync-engine.js";

export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  visibility: string;
  created_by: string;
  github_repo_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectPhase {
  id: string;
  project_id: string;
  name: string;
  display_order: number;
  status: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface ProjectWithDetails extends Project {
  member_count: number;
  phase_count: number;
  doc_count: number;
}

const DEFAULT_PHASES = [
  { name: "Discovery", order: 1 },
  { name: "Requirements", order: 2 },
  { name: "Design", order: 3 },
  { name: "Development", order: 4 },
  { name: "Testing", order: 5 },
  { name: "Deployment", order: 6 },
];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function ensureUniqueSlug(baseSlug: string): string {
  const db = getDb();
  let slug = baseSlug;
  let counter = 1;
  while (db.prepare("SELECT 1 FROM projects WHERE slug = ?").get(slug)) {
    slug = `${baseSlug}-${counter++}`;
  }
  return slug;
}

export function createProject(
  name: string,
  createdBy: string,
  description?: string,
  githubRepoUrl?: string
): Project {
  const db = getDb();
  const id = randomUUID();
  const slug = ensureUniqueSlug(slugify(name));

  const phaseRows: ProjectPhase[] = [];
  const memberAddedAt = new Date().toISOString();

  const create = db.transaction(() => {
    db.prepare(
      "INSERT INTO projects (id, name, slug, description, visibility, created_by, github_repo_url) VALUES (?, ?, ?, ?, 'internal', ?, ?)"
    ).run(id, name, slug, description ?? null, createdBy, githubRepoUrl ?? null);

    // Add creator as owner
    db.prepare(
      "INSERT INTO project_members (project_id, user_id, role, added_at) VALUES (?, ?, 'owner', ?)"
    ).run(id, createdBy, memberAddedAt);

    // Seed default phases
    const insertPhase = db.prepare(
      "INSERT INTO project_phases (id, project_id, name, display_order) VALUES (?, ?, ?, ?)"
    );
    for (const phase of DEFAULT_PHASES) {
      const phaseId = randomUUID();
      insertPhase.run(phaseId, id, phase.name, phase.order);
      phaseRows.push(
        db.prepare("SELECT * FROM project_phases WHERE id = ?").get(phaseId) as ProjectPhase
      );
    }
  });

  create();

  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project;

  recordChange("projects", id, "INSERT", project as unknown as Record<string, unknown>);
  recordChange("project_members", `${id}:${createdBy}`, "INSERT", {
    project_id: id,
    user_id: createdBy,
    role: "owner",
    added_at: memberAddedAt,
  });
  for (const phase of phaseRows) {
    recordChange("project_phases", phase.id, "INSERT", phase as unknown as Record<string, unknown>);
  }

  return project;
}

export function getProjectBySlug(slug: string): ProjectWithDetails | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM project_members WHERE project_id = p.id) as member_count,
        (SELECT COUNT(*) FROM project_phases WHERE project_id = p.id) as phase_count,
        (SELECT COUNT(*) FROM documents WHERE project_id = p.id) as doc_count
      FROM projects p WHERE p.slug = ?`
    )
    .get(slug) as ProjectWithDetails | undefined;
}

export function listProjectsForUser(userId: string): ProjectWithDetails[] {
  const db = getDb();
  // A creator should always see their own project even if their project_members
  // row is missing — past incidents (sync DELETE replay, manual repair) have
  // dropped owner rows and silently hidden the project from its creator.
  return db
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM project_members WHERE project_id = p.id) as member_count,
        (SELECT COUNT(*) FROM project_phases WHERE project_id = p.id) as phase_count,
        (SELECT COUNT(*) FROM documents WHERE project_id = p.id) as doc_count
      FROM projects p
      LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
      WHERE (pm.user_id = ? OR p.created_by = ?) AND p.status != 'archived'
      GROUP BY p.id
      ORDER BY p.updated_at DESC`
    )
    .all(userId, userId, userId) as ProjectWithDetails[];
}

export function listAllProjects(): ProjectWithDetails[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM project_members WHERE project_id = p.id) as member_count,
        (SELECT COUNT(*) FROM project_phases WHERE project_id = p.id) as phase_count,
        (SELECT COUNT(*) FROM documents WHERE project_id = p.id) as doc_count
      FROM projects p
      WHERE p.status != 'archived'
      ORDER BY p.updated_at DESC`
    )
    .all() as ProjectWithDetails[];
}

export function updateProject(
  slug: string,
  updates: { name?: string; description?: string; status?: string; visibility?: string; github_repo_url?: string }
): Project | undefined {
  const db = getDb();
  const project = db
    .prepare("SELECT * FROM projects WHERE slug = ?")
    .get(slug) as Project | undefined;
  if (!project) return undefined;

  const fields: string[] = [];
  const values: any[] = [];

  if (updates.name !== undefined) {
    fields.push("name = ?");
    values.push(updates.name);
  }
  if (updates.description !== undefined) {
    fields.push("description = ?");
    values.push(updates.description);
  }
  if (updates.status !== undefined) {
    fields.push("status = ?");
    values.push(updates.status);
  }
  if (updates.visibility !== undefined) {
    fields.push("visibility = ?");
    values.push(updates.visibility);
  }
  if (updates.github_repo_url !== undefined) {
    fields.push("github_repo_url = ?");
    values.push(updates.github_repo_url);
  }

  if (fields.length === 0) return project;

  fields.push("updated_at = datetime('now')");
  values.push(project.id);

  db.prepare(`UPDATE projects SET ${fields.join(", ")} WHERE id = ?`).run(...values);

  const updated = db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(project.id) as Project;

  recordChange("projects", updated.id, "UPDATE", updated as unknown as Record<string, unknown>);

  return updated;
}

export function deleteProject(slug: string): Project | undefined {
  const db = getDb();
  const project = db.prepare("SELECT * FROM projects WHERE slug = ?").get(slug) as
    | Project
    | undefined;
  if (!project) return undefined;

  const result = db.prepare("DELETE FROM projects WHERE id = ?").run(project.id);
  if (result.changes === 0) return undefined;

  recordChange("projects", project.id, "DELETE", project as unknown as Record<string, unknown>);
  return project;
}

export function archiveProject(slug: string): boolean {
  const db = getDb();
  const project = db.prepare("SELECT * FROM projects WHERE slug = ?").get(slug) as
    | Project
    | undefined;
  if (!project) return false;

  const result = db
    .prepare("UPDATE projects SET status = 'archived', updated_at = datetime('now') WHERE slug = ?")
    .run(slug);

  if (result.changes > 0) {
    const updated = db.prepare("SELECT * FROM projects WHERE id = ?").get(project.id) as Project;
    recordChange("projects", updated.id, "UPDATE", updated as unknown as Record<string, unknown>);
  }

  return result.changes > 0;
}

// Phase operations
export function getProjectPhases(projectId: string): (ProjectPhase & { doc_count: number })[] {
  return getDb()
    .prepare(
      `SELECT pp.*,
        (SELECT COUNT(*) FROM documents WHERE phase_id = pp.id) as doc_count
      FROM project_phases pp
      WHERE pp.project_id = ?
      ORDER BY pp.display_order`
    )
    .all(projectId) as (ProjectPhase & { doc_count: number })[];
}

export function updatePhaseStatus(
  phaseId: string,
  status: string
): void {
  const db = getDb();
  const updates: Record<string, string | null> = { status };

  if (status === "in-progress" ) {
    updates.started_at = new Date().toISOString();
  } else if (status === "completed") {
    updates.completed_at = new Date().toISOString();
  }

  const fields = Object.keys(updates)
    .map((k) => `${k} = ?`)
    .join(", ");
  const values = Object.values(updates);

  db.prepare(`UPDATE project_phases SET ${fields} WHERE id = ?`).run(
    ...values,
    phaseId
  );

  const row = db.prepare("SELECT * FROM project_phases WHERE id = ?").get(phaseId) as
    | ProjectPhase
    | undefined;
  if (row) {
    recordChange("project_phases", phaseId, "UPDATE", row as unknown as Record<string, unknown>);
  }
}
