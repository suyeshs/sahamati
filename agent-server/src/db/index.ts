import Database from "libsql";
import { readFileSync, writeFileSync, chmodSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";
import { EMBEDDED_MIGRATIONS } from "./embedded-migrations.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isBunBinary = __dirname.startsWith("/$bunfs");

function projectRoot(): string {
  return process.env.__SAHAMATI_ROOT || resolve(__dirname, "../../..");
}

const DATA_DIR = resolve(projectRoot(), "data");
const DB_PATH = join(DATA_DIR, "sahamati.db");
const KEY_PATH = join(DATA_DIR, ".db-key");
const MIGRATIONS_DIR = isBunBinary
  ? resolve(projectRoot(), "agent-server/src/db/migrations")
  : resolve(__dirname, "./migrations");

/** The driver's Database handle, named in one place so consumers don't import the driver directly. */
export type DB = import("libsql").Database;

let db: DB;

// libsql's native binding supports at-rest encryption via encryptionKey/encryptionCipher,
// but its bundled types (copied from better-sqlite3) omit them — model the supported
// options at the boundary rather than reaching for `any`.
type LibsqlOptions = NonNullable<ConstructorParameters<typeof Database>[1]>;
type EncryptedDbOptions = LibsqlOptions & {
  encryptionKey?: string;
  encryptionCipher?: string;
};

function getOrCreateEncryptionKey(): string {
  if (process.env.SAHAMATI_DB_KEY) {
    return process.env.SAHAMATI_DB_KEY;
  }

  if (existsSync(KEY_PATH)) {
    return readFileSync(KEY_PATH, "utf-8").trim();
  }

  const key = randomBytes(32).toString("hex");
  writeFileSync(KEY_PATH, key, { mode: 0o600 });
  chmodSync(KEY_PATH, 0o600);
  console.log("Generated new database encryption key at", KEY_PATH);
  return key;
}

export function getDb(): DB {
  if (!db) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return db;
}

export function initDb(): DB {
  if (db) return db;

  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  const options: EncryptedDbOptions = { encryptionKey: getOrCreateEncryptionKey() };
  db = new Database(DB_PATH, options);

  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  runMigrations();

  console.log("Database initialized at", DB_PATH);
  return db;
}

function runMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT UNIQUE NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    db
      .prepare("SELECT filename FROM _migrations")
      .all()
      .map((row: any) => row.filename)
  );

  const migrationFiles = ["001_initial.sql", "002_add_visibility.sql", "003_add_totp.sql", "004_add_video_tables.sql", "005_add_document_content.sql", "006_add_security_scans.sql", "007_add_deployments.sql", "008_add_agent_registry.sql", "009_add_defender.sql", "010_add_finding_status_timestamp.sql", "011_add_cve_watch.sql"];

  for (const filename of migrationFiles) {
    if (applied.has(filename)) continue;

    // Dev reads the source tree; compiled binaries fall back to the copies
    // embedded at build time (installed bundles ship no source tree). A
    // migration that can't be found anywhere is a build defect — fail loudly
    // rather than start with a partial schema.
    const filePath = join(MIGRATIONS_DIR, filename);
    const sql = existsSync(filePath)
      ? readFileSync(filePath, "utf-8")
      : EMBEDDED_MIGRATIONS[filename];
    if (sql === undefined) {
      throw new Error(`Migration ${filename} not found on disk or embedded`);
    }

    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (filename) VALUES (?)").run(filename);
    })();

    console.log(`Applied migration: ${filename}`);
  }
}

export function closeDb() {
  if (db) {
    db.close();
  }
}

export function _setDbForTests(testDb: DB) {
  db = testDb;
}
