/**
 * Export the tables the docs portal build needs (projects, phases, documents)
 * to data/portal-export.json.
 *
 * docs/portal/scripts/collect_docs.py used to read data/sahamati.db directly
 * with Python's sqlite3, which can't open the libsql page-encrypted format.
 * This script is the bridge: it opens the DB with the encryption key (from
 * data/.db-key or $SAHAMATI_DB_KEY) and writes a plaintext JSON snapshot that
 * the collector prefers over the raw DB. The snapshot lives in data/ (gitignored)
 * and contains only portal metadata + file paths — no secrets, no file content.
 *
 * Run from agent-server/:  bun scripts/export-portal-data.ts
 */
import Database from "libsql";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const dataDir = join(repoRoot, "data");
const dbPath = join(dataDir, "sahamati.db");
const keyPath = join(dataDir, ".db-key");
const outPath = join(dataDir, "portal-export.json");

type EncryptedDbOptions = NonNullable<ConstructorParameters<typeof Database>[1]> & {
  encryptionKey?: string;
};

function main() {
  if (!existsSync(dbPath)) {
    // Fresh checkout / CI without local data — the collector skips the
    // sqlite category when neither the DB nor the export exists.
    console.log(`No database at ${dbPath} — skipping portal export.`);
    return;
  }

  const key = (process.env.SAHAMATI_DB_KEY || readFileSync(keyPath, "utf-8")).trim();
  const db = new Database(dbPath, {
    readonly: true,
    encryptionKey: key,
  } as EncryptedDbOptions);

  const projects = db
    .prepare(
      `SELECT id, name, slug, description, status, github_repo_url
       FROM projects
       WHERE COALESCE(status, '') != 'archived'
       ORDER BY name COLLATE NOCASE`
    )
    .all();
  const phases = db
    .prepare(
      `SELECT id, project_id, name, display_order, status
       FROM project_phases
       ORDER BY display_order`
    )
    .all();
  const documents = db
    .prepare(
      `SELECT id, project_id, title, filename, category, file_path, phase_id, created_at
       FROM documents
       ORDER BY created_at`
    )
    .all();
  db.close();

  // libsql attaches a non-column _metadata property to every row — strip it
  // so it doesn't leak into the snapshot (same hazard as sync-engine.ts).
  const clean = (rows: unknown[]) =>
    (rows as Record<string, unknown>[]).map(({ _metadata, ...rest }) => (void _metadata, rest));

  writeFileSync(
    outPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        projects: clean(projects),
        phases: clean(phases),
        documents: clean(documents),
      },
      null,
      2
    )
  );
  console.log(
    `Exported ${projects.length} projects, ${phases.length} phases, ${documents.length} documents -> ${outPath}`
  );
}

main();
