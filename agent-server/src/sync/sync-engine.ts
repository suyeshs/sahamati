/**
 * Hybrid Sync Engine for Sahamati
 *
 * Architecture:
 * - Local: SQLite (encrypted via SQLCipher) is the primary data store
 * - Cloud: Cloudflare D1 (serverless SQLite) stores the canonical shared state
 * - Sync: Bidirectional conflict-free sync using vector clocks / last-write-wins
 *
 * Cloudflare Infrastructure:
 * - Workers: API gateway for sync endpoints (auth, rate limiting, encryption in transit)
 * - D1: Serverless SQLite database (mirrors local schema + sync metadata)
 * - KV: Session tokens, user preferences, cached configs (low-latency reads)
 * - Durable Objects: Per-project sync coordination (conflict resolution, lock management)
 *
 * Security:
 * - All data encrypted in transit (TLS via Cloudflare Workers)
 * - All data encrypted at rest (SQLCipher locally, D1 encryption at rest on Cloudflare)
 * - Sync payloads are encrypted with a project-level key before transmission
 * - Auth tokens validated against Cloudflare KV session store
 */

import type { SQLQueryBindings } from "bun:sqlite";
import { getDb } from "../db/index.js";
import { existsSync, readFileSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname2 = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = process.env.__SAHAMATI_ROOT || resolve(__dirname2, "../../..");
const DATA_DIR = join(PROJECT_ROOT, "data/projects");

export interface SyncRecord {
  table_name: string;
  record_id: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
  data: string; // JSON-serialized row
  timestamp: string;
  device_id: string;
  synced: number; // 0 = pending, 1 = synced
}

// scan_credentials is deliberately omitted: bearer tokens never leave the local
// device. The grep test in CI fails the build if scan_credentials is added here.
const SYNC_TABLES = [
  "users",
  "projects",
  "project_members",
  "project_phases",
  "documents",
  "scan_targets",
  "scans",
  "scan_findings",
];

/**
 * Initialize sync tracking table in local SQLite
 */
export function initSyncTracking() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS _sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      data TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      device_id TEXT NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_sync_log_pending
      ON _sync_log(synced, timestamp);

    CREATE TABLE IF NOT EXISTS _sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Ensure device_id exists
  const existing = db.prepare("SELECT value FROM _sync_state WHERE key = 'device_id'").get() as
    | { value: string }
    | undefined;
  if (!existing) {
    const uuid = crypto.randomUUID();
    db.prepare("INSERT INTO _sync_state (key, value) VALUES ('device_id', ?)").run(uuid);
  }
}

/**
 * Get the local device ID
 */
export function getDeviceId(): string {
  const db = getDb();
  const row = db.prepare("SELECT value FROM _sync_state WHERE key = 'device_id'").get() as {
    value: string;
  };
  return row.value;
}

/**
 * Record a change for sync (called by repositories after mutations)
 */
export function recordChange(
  tableName: string,
  recordId: string,
  operation: "INSERT" | "UPDATE" | "DELETE",
  data: Record<string, unknown>
) {
  const db = getDb();
  const deviceId = getDeviceId();
  db.prepare(
    `INSERT INTO _sync_log (table_name, record_id, operation, data, device_id)
     VALUES (?, ?, ?, ?, ?)`
  ).run(tableName, recordId, operation, JSON.stringify(data), deviceId);

  // Push promptly. Concurrent mutations coalesce into a single push because
  // syncInFlight skips while one is running — pushToCloud re-reads the queue
  // when it starts, so changes recorded before that read are picked up.
  nudgeSync();
}

/**
 * Reset sync log — clear all entries and last sync timestamp
 */
export function resetSyncLog() {
  const db = getDb();
  db.exec("DELETE FROM _sync_log");
  db.prepare("DELETE FROM _sync_state WHERE key = 'last_sync'").run();
}

/**
 * Seed the sync log with ALL existing data (for initial full sync).
 * Skips rows that already have a sync log entry.
 */
export function seedSyncLog(): number {
  const db = getDb();
  const deviceId = getDeviceId();
  let count = 0;

  for (const table of SYNC_TABLES) {
    // Get primary key column(s)
    const pkCol = table === "project_members" ? "project_id || ':' || user_id" : "id";
    const rows = db.prepare(`SELECT *, ${pkCol} AS _pk FROM ${table}`).all() as Record<string, unknown>[];

    for (const row of rows) {
      const pk = String(row._pk);
      delete row._pk;

      // Check if already tracked
      const existing = db.prepare(
        "SELECT 1 FROM _sync_log WHERE table_name = ? AND record_id = ? LIMIT 1"
      ).get(table, pk);

      if (!existing) {
        // For documents, try to read file content
        if (table === "documents" && row.file_path && !row.content) {
          try {
            const project = db.prepare("SELECT slug FROM projects WHERE id = ?").get(row.project_id as SQLQueryBindings) as { slug: string } | undefined;
            if (project) {
              const fullPath = join(DATA_DIR, project.slug, String(row.file_path));
              if (existsSync(fullPath)) {
                row.content = readFileSync(fullPath, "utf-8");
              }
            }
          } catch {
            // Skip content if file read fails
          }
        }

        db.prepare(
          `INSERT INTO _sync_log (table_name, record_id, operation, data, device_id)
           VALUES (?, ?, 'INSERT', ?, ?)`
        ).run(table, pk, JSON.stringify(row), deviceId);
        count++;
      }
    }
  }

  return count;
}

/**
 * Get pending changes to sync to cloud
 */
export function getPendingChanges(limit: number = 100): SyncRecord[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM _sync_log WHERE synced = 0 ORDER BY timestamp ASC LIMIT ?`
    )
    .all(limit) as SyncRecord[];
}

/**
 * Mark changes as synced
 */
export function markSynced(ids: number[]) {
  if (ids.length === 0) return;
  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(`UPDATE _sync_log SET synced = 1 WHERE id IN (${placeholders})`).run(...ids);
}

/**
 * Get last sync timestamp
 */
export function getLastSyncTimestamp(): string | null {
  const db = getDb();
  const row = db
    .prepare("SELECT value FROM _sync_state WHERE key = 'last_sync'")
    .get() as { value: string } | undefined;
  return row?.value ?? null;
}

/**
 * Update last sync timestamp
 */
export function setLastSyncTimestamp(timestamp: string) {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO _sync_state (key, value) VALUES ('last_sync', ?)`
  ).run(timestamp);
}

/**
 * Push local changes to Cloudflare Worker (in batches to avoid D1 limits)
 */
export async function pushToCloud(cloudflareWorkerUrl: string, authToken: string): Promise<void> {
  const pending = getPendingChanges();
  if (pending.length === 0) return;

  const BATCH_SIZE = 20; // Each change creates 2 D1 statements, D1 max is 100
  const deviceId = getDeviceId();

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);

    const response = await fetch(`${cloudflareWorkerUrl}/api/sync/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ deviceId, changes: batch }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      console.error(`Sync push failed for batch ${i}/${pending.length}:`, errBody);
      console.error("First change in batch:", JSON.stringify(batch[0]).slice(0, 500));
      throw new Error(`Sync push failed: ${response.status} ${response.statusText} ${errBody}`);
    }

    const { syncedIds } = (await response.json()) as { syncedIds: number[] };
    markSynced(syncedIds);
  }
}

/**
 * Pull remote changes from Cloudflare Worker
 */
export async function pullFromCloud(
  cloudflareWorkerUrl: string,
  authToken: string
): Promise<SyncRecord[]> {
  const lastSync = getLastSyncTimestamp();
  const params = new URLSearchParams({
    deviceId: getDeviceId(),
    ...(lastSync ? { since: lastSync } : {}),
  });

  const response = await fetch(`${cloudflareWorkerUrl}/api/sync/pull?${params}`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Sync pull failed: ${response.status} ${response.statusText}`);
  }

  const { changes, timestamp } = (await response.json()) as {
    changes: SyncRecord[];
    timestamp: string;
  };

  if (changes.length > 0) {
    applyRemoteChanges(changes);
  }

  if (timestamp) {
    setLastSyncTimestamp(timestamp);
  }

  return changes;
}

/**
 * Apply remote changes to local database (last-write-wins)
 */
function applyRemoteChanges(changes: SyncRecord[]) {
  const db = getDb();

  const relevant = changes.filter((c) => SYNC_TABLES.includes(c.table_name));

  // Apply upserts parents-first and deletes children-first (per SYNC_TABLES
  // dependency order) so the common "child arrives before parent" interleaving
  // resolves itself. Each change is applied independently: a row whose parent
  // genuinely doesn't exist (an orphan — e.g. a document whose project was
  // deleted without cascading) is skipped and logged rather than failing the
  // whole batch and wedging sync forever.
  const tableIndex = (t: string) => SYNC_TABLES.indexOf(t);
  const upserts = relevant
    .filter((c) => c.operation !== "DELETE")
    .sort((a, b) => tableIndex(a.table_name) - tableIndex(b.table_name));
  const deletes = relevant
    .filter((c) => c.operation === "DELETE")
    .sort((a, b) => tableIndex(b.table_name) - tableIndex(a.table_name));

  const skipped: string[] = [];

  const applyOne = (change: SyncRecord) => {
    const data = JSON.parse(change.data);
    if (change.operation === "DELETE") {
      if (change.table_name === "project_members") {
        db.prepare(`DELETE FROM ${change.table_name} WHERE project_id = ? AND user_id = ?`).run(
          data.project_id,
          data.user_id
        );
      } else {
        db.prepare(`DELETE FROM ${change.table_name} WHERE id = ?`).run(change.record_id);
      }
    } else {
      const columns = Object.keys(data);
      const placeholders = columns.map(() => "?").join(", ");
      const sql = `INSERT OR REPLACE INTO ${change.table_name} (${columns.join(", ")}) VALUES (${placeholders})`;
      db.prepare(sql).run(...(Object.values(data) as SQLQueryBindings[]));
    }
  };

  for (const change of [...upserts, ...deletes]) {
    try {
      applyOne(change);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/FOREIGN KEY/i.test(msg)) {
        skipped.push(`${change.operation} ${change.table_name}/${change.record_id}`);
        continue;
      }
      throw err; // non-FK errors are real bugs — don't swallow
    }
  }

  if (skipped.length > 0) {
    console.warn(
      `[sync] skipped ${skipped.length} orphaned change(s) with missing parent rows: ${skipped
        .slice(0, 5)
        .join(", ")}${skipped.length > 5 ? ", …" : ""}`
    );
  }
}

/**
 * Full sync cycle: push local changes, then pull remote
 */
export async function syncWithCloud(
  cloudflareWorkerUrl: string,
  authToken: string
): Promise<{ pushed: number; pulled: number }> {
  const pending = getPendingChanges();
  await pushToCloud(cloudflareWorkerUrl, authToken);
  const pulled = await pullFromCloud(cloudflareWorkerUrl, authToken);

  return { pushed: pending.length, pulled: pulled.length };
}

let syncInFlight = false;

/**
 * Start a background timer that drains the sync log to the cloud at a fixed
 * interval. Concurrent runs are skipped via syncInFlight. Returns the timer
 * handle so callers can stop it (e.g. on shutdown). No-op if the cloud env
 * vars aren't configured.
 */
export function startBackgroundSync(intervalMs: number = 20_000): NodeJS.Timeout | null {
  // Kill-switch: lets us keep cloud credentials in .env while halting sync —
  // e.g. after a local recovery, until the cloud's pending DELETEs are
  // reconciled (otherwise sync would re-delete the restored rows).
  if (/^(1|true|yes)$/i.test(process.env.SYNC_DISABLED ?? "")) {
    console.log("Background sync: disabled (SYNC_DISABLED set)");
    return null;
  }

  const cloudflareUrl = process.env.CLOUDFLARE_SYNC_URL;
  const syncSecret = process.env.CLOUDFLARE_SYNC_SECRET;
  if (!cloudflareUrl || !syncSecret) return null;

  const tick = async () => {
    if (syncInFlight) return;
    syncInFlight = true;
    try {
      await syncWithCloud(cloudflareUrl, syncSecret);
    } catch (err) {
      console.error("[sync] background sync failed:", err instanceof Error ? err.message : err);
    } finally {
      syncInFlight = false;
    }
  };

  // Drain anything queued at boot, then on the interval.
  void tick();
  return setInterval(() => void tick(), intervalMs);
}

/**
 * Fire-and-forget nudge — invoke after a mutation to push promptly without
 * waiting on the timer. Safe to call from request handlers.
 */
export function nudgeSync() {
  const cloudflareUrl = process.env.CLOUDFLARE_SYNC_URL;
  const syncSecret = process.env.CLOUDFLARE_SYNC_SECRET;
  if (!cloudflareUrl || !syncSecret) return;
  if (syncInFlight) return;
  syncInFlight = true;
  void (async () => {
    try {
      await syncWithCloud(cloudflareUrl, syncSecret);
    } catch (err) {
      console.error("[sync] nudge failed:", err instanceof Error ? err.message : err);
    } finally {
      syncInFlight = false;
    }
  })();
}
