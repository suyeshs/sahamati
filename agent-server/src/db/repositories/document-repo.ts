import { randomUUID } from "crypto";
import { getDb } from "../index.js";

export interface Document {
  id: string;
  project_id: string;
  phase_id: string | null;
  title: string;
  filename: string;
  category: string;
  file_path: string;
  generated_by: string | null;
  requires_review: number;
  confidence: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentWithPhase extends Document {
  phase_name?: string;
  phase_order?: number;
}

export function createDocument(params: {
  projectId: string;
  phaseId?: string;
  title: string;
  filename: string;
  category: string;
  filePath: string;
  generatedBy?: string;
  requiresReview?: boolean;
  confidence?: number;
  createdBy?: string;
}): Document {
  const db = getDb();
  const id = randomUUID();

  db.prepare(
    `INSERT INTO documents (id, project_id, phase_id, title, filename, category, file_path, generated_by, requires_review, confidence, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.projectId,
    params.phaseId ?? null,
    params.title,
    params.filename,
    params.category,
    params.filePath,
    params.generatedBy ?? null,
    params.requiresReview ? 1 : 0,
    params.confidence ?? null,
    params.createdBy ?? null
  );

  return db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as Document;
}

export function listDocuments(
  projectId: string,
  phaseId?: string
): DocumentWithPhase[] {
  const db = getDb();

  if (phaseId) {
    return db
      .prepare(
        `SELECT d.*, pp.name as phase_name, pp.display_order as phase_order
        FROM documents d
        LEFT JOIN project_phases pp ON pp.id = d.phase_id
        WHERE d.project_id = ? AND d.phase_id = ?
        ORDER BY d.created_at DESC`
      )
      .all(projectId, phaseId) as DocumentWithPhase[];
  }

  return db
    .prepare(
      `SELECT d.*, pp.name as phase_name, pp.display_order as phase_order
      FROM documents d
      LEFT JOIN project_phases pp ON pp.id = d.phase_id
      WHERE d.project_id = ?
      ORDER BY COALESCE(pp.display_order, 999), d.created_at DESC`
    )
    .all(projectId) as DocumentWithPhase[];
}

export function getDocument(docId: string, projectId?: string): Document | undefined {
  if (projectId) {
    return getDb()
      .prepare("SELECT * FROM documents WHERE id = ? AND project_id = ?")
      .get(docId, projectId) as Document | undefined;
  }
  return getDb()
    .prepare("SELECT * FROM documents WHERE id = ?")
    .get(docId) as Document | undefined;
}

export function deleteDocument(docId: string, projectId?: string): boolean {
  if (projectId) {
    const result = getDb()
      .prepare("DELETE FROM documents WHERE id = ? AND project_id = ?")
      .run(docId, projectId);
    return result.changes > 0;
  }
  const result = getDb()
    .prepare("DELETE FROM documents WHERE id = ?")
    .run(docId);
  return result.changes > 0;
}
