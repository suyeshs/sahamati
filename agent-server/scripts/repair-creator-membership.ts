/**
 * One-off repair: ensure every project's creator has an `owner` row in
 * project_members. We saw cases where the creator was dropped from the
 * members table (likely from a sync DELETE replay) and was therefore
 * hidden from their own project list. This is idempotent — re-running
 * does nothing if the row already exists.
 *
 * Usage:  bun scripts/repair-creator-membership.ts
 * Run from agent-server/. The DB key is read the same way as the server
 * (SAHAMATI_DB_KEY env or data/.db-key file).
 */

import Database from "libsql";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  created_by: string | null;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");
const DB_PATH = join(PROJECT_ROOT, "data/sahamati.db");
const KEY_PATH = join(PROJECT_ROOT, "data/.db-key");

const encryptionKey =
  process.env.SAHAMATI_DB_KEY ||
  (existsSync(KEY_PATH) ? readFileSync(KEY_PATH, "utf-8").trim() : "");

// libsql does at-rest encryption via the constructor's encryptionKey option, not
// PRAGMA key. Its bundled types (copied from better-sqlite3) omit the field, so
// model it at the boundary — same shape as src/db/index.ts. Open plaintext only
// when no key is available (a legacy unencrypted local DB).
type LibsqlOptions = NonNullable<ConstructorParameters<typeof Database>[1]>;
type EncryptedDbOptions = LibsqlOptions & { encryptionKey?: string };

const options: EncryptedDbOptions = encryptionKey ? { encryptionKey } : {};
const db = new Database(DB_PATH, options);
// Wait politely if the agent server holds a write lock.
db.pragma("busy_timeout = 5000");

function getDeviceId(): string {
  const row = db
    .prepare("SELECT value FROM _sync_state WHERE key = 'device_id'")
    .get() as { value: string } | undefined;
  return row?.value || "repair-script";
}

const projects = db
  .prepare("SELECT id, name, slug, created_by FROM projects WHERE created_by IS NOT NULL")
  .all() as ProjectRow[];

const checkMember = db.prepare(
  "SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?"
);
const insertMember = db.prepare(
  "INSERT INTO project_members (project_id, user_id, role, added_at) VALUES (?, ?, 'owner', ?)"
);

let repaired = 0;
for (const p of projects) {
  if (!p.created_by) continue;
  const existing = checkMember.get(p.id, p.created_by);
  if (existing) continue;

  const addedAt = new Date().toISOString();
  const deviceId = getDeviceId();
  const data = JSON.stringify({
    project_id: p.id,
    user_id: p.created_by,
    role: "owner",
    added_at: addedAt,
  });
  const tx = db.transaction(() => {
    insertMember.run(p.id, p.created_by, addedAt);
    db.prepare(
      `INSERT INTO _sync_log (table_name, record_id, operation, data, device_id)
       VALUES (?, ?, ?, ?, ?)`
    ).run("project_members", `${p.id}:${p.created_by}`, "INSERT", data, deviceId);
  });
  tx();
  console.log(`[repair] ${p.slug}: added owner row for ${p.created_by}`);
  repaired++;
}

console.log(`[repair] done — scanned ${projects.length} project(s), repaired ${repaired}`);
db.close();
