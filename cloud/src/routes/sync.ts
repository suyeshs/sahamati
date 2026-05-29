/**
 * Sync API routes — desktop app <-> cloud D1
 */
import { Hono } from "hono";
import type { Env } from "../worker";
import { uploadDoc, deleteDoc } from "../gcs";

interface SyncChange {
  id?: number;
  table_name: string;
  record_id: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
  data: string;
  timestamp: string;
  device_id: string;
}

const sync = new Hono<{ Bindings: Env }>();

// Auth middleware for sync endpoints
sync.use("*", async (c, next) => {
  if (c.req.path === "/api/sync/init" || c.req.method === "OPTIONS") {
    return next();
  }
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ") || authHeader.slice(7) !== c.env.SYNC_SECRET) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return next();
});

// Initialize D1 schema
sync.post("/init", async (c) => {
  await c.env.DB.batch([
    c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
        picture TEXT, role TEXT NOT NULL DEFAULT 'member',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )
    `),
    c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
        description TEXT, status TEXT NOT NULL DEFAULT 'active',
        visibility TEXT NOT NULL DEFAULT 'private',
        created_by TEXT NOT NULL, github_repo_url TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )
    `),
    c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS project_members (
        project_id TEXT NOT NULL, user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member', added_at TEXT NOT NULL,
        PRIMARY KEY (project_id, user_id)
      )
    `),
    c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS project_phases (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
        display_order INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'not-started',
        started_at TEXT, completed_at TEXT
      )
    `),
    c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, phase_id TEXT,
        title TEXT NOT NULL, filename TEXT NOT NULL, category TEXT NOT NULL,
        file_path TEXT NOT NULL, generated_by TEXT, requires_review INTEGER DEFAULT 0,
        confidence REAL, created_by TEXT, content TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )
    `),
    c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS _sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT NOT NULL,
        record_id TEXT NOT NULL, operation TEXT NOT NULL, data TEXT NOT NULL,
        timestamp TEXT NOT NULL, device_id TEXT NOT NULL
      )
    `),
    c.env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_sync_log_timestamp ON _sync_log(timestamp)`
    ),
    c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS allowed_emails (
        email TEXT PRIMARY KEY,
        added_by TEXT,
        added_at TEXT NOT NULL,
        note TEXT
      )
    `),
    // Security scan mirrors. scan_credentials is intentionally NOT mirrored —
    // bearer tokens never leave the device.
    c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS scan_targets (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, label TEXT NOT NULL,
        base_url TEXT NOT NULL, environment TEXT NOT NULL,
        approved_by TEXT, approved_at TEXT, approval_reason TEXT,
        scan_profile TEXT NOT NULL DEFAULT 'safe-default',
        schedule_cron TEXT, active INTEGER NOT NULL DEFAULT 1,
        auth_credential_id TEXT,
        created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )
    `),
    c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS scans (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, target_id TEXT NOT NULL,
        status TEXT NOT NULL, trigger TEXT NOT NULL, triggered_by TEXT,
        started_at TEXT, completed_at TEXT, request_count INTEGER NOT NULL DEFAULT 0,
        summary TEXT, report_path TEXT, error TEXT
      )
    `),
    c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS scan_findings (
        id TEXT PRIMARY KEY, scan_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
        severity TEXT NOT NULL, category TEXT NOT NULL, cwe TEXT,
        title TEXT NOT NULL, description TEXT NOT NULL, location TEXT NOT NULL,
        evidence TEXT, remediation TEXT,
        status TEXT NOT NULL DEFAULT 'open', first_seen_scan_id TEXT,
        created_at TEXT NOT NULL
      )
    `),
    c.env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_cloud_scan_targets_project ON scan_targets(project_id)`
    ),
    c.env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_cloud_scans_target ON scans(target_id)`
    ),
    c.env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_cloud_findings_scan ON scan_findings(scan_id)`
    ),
  ]);

  // Migrations: add columns that may not exist on older deployments
  try {
    await c.env.DB.prepare("ALTER TABLE projects ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'").run();
  } catch {
    // Column already exists — ignore
  }

  return c.json({ success: true, message: "D1 schema initialized" });
});

// Push changes from local to cloud
sync.post("/push", async (c) => {
  const { deviceId, changes } = (await c.req.json()) as {
    deviceId: string;
    changes: SyncChange[];
  };

  if (!deviceId || !changes?.length) {
    return c.json({ syncedIds: [] });
  }

  const syncedIds: number[] = [];
  const stmts: D1PreparedStatement[] = [];

  // Collect GCS uploads to run after D1 batch
  const gcsUploads: Array<{ projectId: string; docId: string; content: string }> = [];

  for (const change of changes) {
    const data = JSON.parse(change.data);

    switch (change.operation) {
      case "INSERT":
      case "UPDATE": {
        // For documents: extract content for GCS, don't store in D1
        if (change.table_name === "documents" && data.content) {
          gcsUploads.push({
            projectId: String(data.project_id),
            docId: String(data.id),
            content: String(data.content),
          });
          delete data.content;
        }

        const columns = Object.keys(data);
        const placeholders = columns.map(() => "?").join(", ");

        // Use INSERT OR REPLACE to handle all unique constraints (email, slug, etc.)
        const sql = `INSERT OR REPLACE INTO ${change.table_name} (${columns.join(", ")})
          VALUES (${placeholders})`;

        stmts.push(c.env.DB.prepare(sql).bind(...Object.values(data)));
        break;
      }
      case "DELETE": {
        if (change.table_name === "project_members") {
          stmts.push(
            c.env.DB.prepare(
              `DELETE FROM ${change.table_name} WHERE project_id = ? AND user_id = ?`
            ).bind(data.project_id, data.user_id)
          );
        } else {
          stmts.push(
            c.env.DB.prepare(`DELETE FROM ${change.table_name} WHERE id = ?`).bind(
              change.record_id
            )
          );
        }
        // Queue GCS deletion for documents
        if (change.table_name === "documents" && data.project_id) {
          gcsUploads.push({ projectId: String(data.project_id), docId: change.record_id, content: "" });
        }
        break;
      }
    }

    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO _sync_log (table_name, record_id, operation, data, timestamp, device_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        change.table_name,
        change.record_id,
        change.operation,
        change.data,
        change.timestamp,
        deviceId
      )
    );

    if (change.id) syncedIds.push(change.id);
  }

  if (stmts.length > 0) {
    await c.env.DB.batch(stmts);
  }

  // Upload document content to GCS (async, non-blocking for batch)
  if (gcsUploads.length > 0 && c.env.GCS_SERVICE_ACCOUNT_KEY && c.env.GCS_BUCKET) {
    // Look up project slugs
    const projectIds = [...new Set(gcsUploads.map((u) => u.projectId))];
    const slugMap = new Map<string, string>();
    for (const pid of projectIds) {
      const row = await c.env.DB.prepare("SELECT slug FROM projects WHERE id = ?").bind(pid).first<{ slug: string }>();
      if (row) slugMap.set(pid, row.slug);
    }

    const uploads = gcsUploads.map(async ({ projectId, docId, content }) => {
      const slug = slugMap.get(projectId);
      if (!slug) return;
      try {
        if (content) {
          await uploadDoc(c.env.GCS_SERVICE_ACCOUNT_KEY, c.env.GCS_BUCKET, slug, docId, content);
        } else {
          await deleteDoc(c.env.GCS_SERVICE_ACCOUNT_KEY, c.env.GCS_BUCKET, slug, docId);
        }
      } catch (err) {
        console.error(`GCS operation failed for doc ${docId}:`, err);
      }
    });
    await Promise.all(uploads);
  }

  await c.env.KV.put(`device:${deviceId}:last_push`, new Date().toISOString());

  return c.json({ syncedIds, applied: changes.length });
});

// Pull changes from cloud to local
sync.get("/pull", async (c) => {
  const deviceId = c.req.query("deviceId");
  const since = c.req.query("since");

  if (!deviceId) {
    return c.json({ error: "deviceId required" }, 400);
  }

  let query = `SELECT * FROM _sync_log WHERE device_id != ?`;
  const params: unknown[] = [deviceId];

  if (since) {
    query += ` AND timestamp > ?`;
    params.push(since);
  }

  query += ` ORDER BY timestamp ASC LIMIT 500`;

  const result = await c.env.DB.prepare(query).bind(...params).all();
  const timestamp = new Date().toISOString();

  await c.env.KV.put(`device:${deviceId}:last_pull`, timestamp);

  return c.json({ changes: result.results, timestamp });
});

export { sync as syncRoutes };
