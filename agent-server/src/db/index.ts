import Database from "better-sqlite3-multiple-ciphers";
import { readFileSync, writeFileSync, chmodSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";

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

let db: Database.Database;

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

export function getDb(): Database.Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return db;
}

// A keyed connection can read the database only when the supplied key matches
// (or the file is brand new). We probe sqlite_master because the cipher is not
// validated until the first page is actually read.
function canRead(conn: Database.Database): boolean {
  try {
    conn.prepare("SELECT count(*) FROM sqlite_master").get();
    return true;
  } catch {
    return false;
  }
}

export function initDb(): Database.Database {
  if (db) return db;

  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  const encryptionKey = getOrCreateEncryptionKey();
  const dbExisted = existsSync(DB_PATH);

  db = new Database(DB_PATH);
  db.pragma(`key = '${encryptionKey}'`);

  // An existing file may be a legacy plaintext database created before encryption
  // was wired up. If the keyed read fails, reopen without a key: if it then reads
  // as plaintext, encrypt it in place via rekey; otherwise the key is simply wrong.
  if (dbExisted && !canRead(db)) {
    db.close();
    db = new Database(DB_PATH);
    if (!canRead(db)) {
      throw new Error(
        `Cannot open database at ${DB_PATH}: wrong SAHAMATI_DB_KEY or corrupt file. ` +
          `The key is read from SAHAMATI_DB_KEY or ${KEY_PATH}.`
      );
    }
    // Rekey is rejected in WAL mode, so drop to a rollback journal first; the
    // normal init path below re-enables WAL on the now-encrypted database.
    db.pragma("journal_mode = DELETE");
    db.pragma(`rekey = '${encryptionKey}'`);
    console.warn("Encrypted legacy plaintext database in place at", DB_PATH);
  }

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

  const migrationFiles = ["001_initial.sql", "002_add_visibility.sql", "003_add_totp.sql", "004_add_video_tables.sql", "005_add_document_content.sql", "006_add_security_scans.sql", "007_add_deployments.sql"];

  for (const filename of migrationFiles) {
    if (applied.has(filename)) continue;

    const filePath = join(MIGRATIONS_DIR, filename);
    if (!existsSync(filePath)) {
      console.warn(`Migration file not found: ${filePath}`);
      continue;
    }

    const sql = readFileSync(filePath, "utf-8");

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

export function _setDbForTests(testDb: Database.Database) {
  db = testDb;
}
