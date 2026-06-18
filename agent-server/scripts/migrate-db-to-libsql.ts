/**
 * One-time migration: re-encrypt an existing SQLite database into the libsql
 * page-encrypted format used by src/db/index.ts.
 *
 * The driver moved from better-sqlite3-multiple-ciphers (SQLCipher) to libsql,
 * whose at-rest encryption is NOT cipher-compatible with SQLCipher or with a
 * plaintext file. This copies a PLAINTEXT source DB into a fresh libsql-encrypted
 * DB, reusing the key in data/.db-key (or $SAHAMATI_DB_KEY).
 *
 * Non-destructive: the original is renamed to a timestamped backup; the new
 * encrypted file only replaces it after row counts are verified to match.
 *
 * Run from agent-server/:  bun scripts/migrate-db-to-libsql.ts
 */
import Database from "libsql";
import { readFileSync, existsSync, renameSync, rmSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const dataDir = join(repoRoot, "data");
const dbPath = join(dataDir, "sahamati.db");
const keyPath = join(dataDir, ".db-key");
const newPath = `${dbPath}.libsql-new`;

type EncryptedDbOptions = NonNullable<ConstructorParameters<typeof Database>[1]> & {
  encryptionKey?: string;
};
type SchemaObject = { type: string; name: string; sql: string };

function stamp(): string {
  // Local script (not a workflow) — Date is fine here.
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
}

function tableCounts(db: Database.Database, tables: SchemaObject[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of tables) {
    out[t.name] = (db.prepare(`SELECT COUNT(*) AS c FROM "${t.name}"`).get() as { c: number }).c;
  }
  return out;
}

function main() {
  if (!existsSync(dbPath)) {
    console.error(`No database at ${dbPath} — nothing to migrate.`);
    process.exit(1);
  }
  const header = readFileSync(dbPath).subarray(0, 16).toString("latin1");
  if (!header.startsWith("SQLite format 3")) {
    console.error(
      `${dbPath} is not a plaintext SQLite file (header: ${JSON.stringify(header)}).\n` +
        `This script only migrates PLAINTEXT sources. A SQLCipher-encrypted file must first be ` +
        `decrypted with the better-sqlite3-multiple-ciphers driver before running this.`
    );
    process.exit(1);
  }

  const key = (process.env.SAHAMATI_DB_KEY || readFileSync(keyPath, "utf-8")).trim();
  if (!key) {
    console.error(`No encryption key found (${keyPath} empty and $SAHAMATI_DB_KEY unset).`);
    process.exit(1);
  }

  if (existsSync(newPath)) rmSync(newPath);

  const src = new Database(dbPath, { readonly: true });
  const objects = (src.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL").all() as SchemaObject[]).filter(
    (o) => !o.name.startsWith("sqlite_")
  );
  const tables = objects.filter((o) => o.type === "table");
  const indexes = objects.filter((o) => o.type === "index");
  const triggers = objects.filter((o) => o.type === "trigger");
  const views = objects.filter((o) => o.type === "view");

  const srcCounts = tableCounts(src, tables);
  console.log(`Source (plaintext): ${tables.length} tables, ${Object.values(srcCounts).reduce((a, b) => a + b, 0)} rows total`);

  const options: EncryptedDbOptions = { encryptionKey: key };
  const dest = new Database(newPath, options);
  // Rollback-journal (not WAL) so all data lands in the main file — a WAL sidecar would be
  // orphaned by the rename below. initDb() switches the file back to WAL when the app opens it.
  dest.exec("PRAGMA journal_mode = DELETE");
  dest.exec("PRAGMA foreign_keys = OFF");

  dest.transaction(() => {
    for (const t of tables) dest.exec(t.sql);
    for (const t of tables) {
      const rows = src.prepare(`SELECT * FROM "${t.name}"`).all() as Record<string, unknown>[];
      if (rows.length === 0) continue;
      const cols = Object.keys(rows[0]);
      const insert = dest.prepare(
        `INSERT INTO "${t.name}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`
      );
      for (const row of rows) insert.run(...cols.map((c) => row[c]));
    }
    for (const i of indexes) dest.exec(i.sql);
    for (const tg of triggers) dest.exec(tg.sql);
    for (const v of views) dest.exec(v.sql);
  })();
  dest.exec("PRAGMA foreign_keys = ON");
  src.close();
  dest.close();

  // Verify: reopen encrypted, confirm counts match and the file is not plaintext.
  const verifyHeader = readFileSync(newPath).subarray(0, 16).toString("latin1");
  if (verifyHeader.startsWith("SQLite format 3")) {
    console.error("Migration produced a PLAINTEXT file — encryption did not apply. Aborting, original untouched.");
    rmSync(newPath);
    process.exit(1);
  }
  const verify = new Database(newPath, options);
  const destCounts = tableCounts(verify, tables);
  verify.close();

  const mismatches = tables.filter((t) => srcCounts[t.name] !== destCounts[t.name]);
  if (mismatches.length > 0) {
    console.error("Row-count mismatch after migration — aborting, original untouched:");
    for (const t of mismatches) console.error(`  ${t.name}: src=${srcCounts[t.name]} dest=${destCounts[t.name]}`);
    rmSync(newPath);
    process.exit(1);
  }

  // Swap: back up plaintext original, clear stale WAL/SHM, promote the encrypted file.
  const backup = join(dataDir, `sahamati.db.plaintext-bak-${stamp()}`);
  renameSync(dbPath, backup);
  for (const base of [dbPath, newPath]) {
    for (const suffix of ["-wal", "-shm"]) {
      const f = `${base}${suffix}`;
      if (existsSync(f)) rmSync(f);
    }
  }
  renameSync(newPath, dbPath);

  console.log(`\nMigrated ${tables.length} tables, all row counts verified.`);
  console.log(`Encrypted DB:        ${dbPath}`);
  console.log(`Plaintext backup at: ${backup}`);
  console.log(`\nVerify the app, then you may delete the plaintext backup and the *.encrypted-bak-* / *.backup-* files.`);
}

main();
