import { randomUUID } from "crypto";
import { getDb } from "../db/index.js";
import { recordChange } from "../sync/sync-engine.js";
import { encryptToken, decryptToken } from "./credentials-crypto.js";

export { fingerprintsEqual } from "./credentials-crypto.js";

export interface ScanCredential {
  id: string;
  project_id: string;
  type: "bearer";
  created_by: string;
  created_at: string;
  last_used_at: string | null;
  rotated_at: string | null;
}

export function storeBearerToken(params: {
  projectId: string;
  token: string;
  createdBy: string;
}): ScanCredential {
  const { ciphertext, nonce } = encryptToken(params.token);
  const id = randomUUID();
  const db = getDb();
  db.prepare(
    `INSERT INTO scan_credentials (id, project_id, type, ciphertext, nonce, created_by)
     VALUES (?, ?, 'bearer', ?, ?, ?)`
  ).run(id, params.projectId, ciphertext, nonce, params.createdBy);

  const row = readMetadata(id);
  if (!row) throw new Error("failed to read back stored credential");

  // Sync log records metadata only — ciphertext stays local. The sync engine
  // also excludes scan_credentials from SYNC_TABLES as a second layer of defense.
  recordChange("scan_credentials", id, "INSERT", {
    id,
    project_id: row.project_id,
    type: row.type,
    created_by: row.created_by,
    created_at: row.created_at,
  });

  return row;
}

export function rotateBearerToken(id: string, newToken: string): ScanCredential {
  const { ciphertext, nonce } = encryptToken(newToken);
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE scan_credentials
       SET ciphertext = ?, nonce = ?, rotated_at = datetime('now')
       WHERE id = ?`
    )
    .run(ciphertext, nonce, id);
  if (result.changes === 0) throw new Error("credential not found");
  const row = readMetadata(id);
  if (!row) throw new Error("failed to read back rotated credential");
  recordChange("scan_credentials", id, "UPDATE", {
    id,
    rotated_at: row.rotated_at,
  });
  return row;
}

export function deleteBearerToken(id: string): boolean {
  const db = getDb();
  const row = readMetadata(id);
  const result = db.prepare("DELETE FROM scan_credentials WHERE id = ?").run(id);
  if (result.changes > 0 && row) {
    recordChange("scan_credentials", id, "DELETE", { id, project_id: row.project_id });
  }
  return result.changes > 0;
}

export function readMetadata(id: string): ScanCredential | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, project_id, type, created_by, created_at, last_used_at, rotated_at
       FROM scan_credentials WHERE id = ?`
    )
    .get(id) as ScanCredential | undefined;
  return row ?? null;
}

/**
 * Decrypt and return a bearer token for use by the scan runner. Updates
 * last_used_at on success. Never logs the plaintext; never returns it over the
 * HTTP API. Only callable from server-side scan execution paths.
 */
export function fetchTokenForUse(id: string): string {
  const db = getDb();
  const row = db
    .prepare("SELECT ciphertext, nonce FROM scan_credentials WHERE id = ?")
    .get(id) as { ciphertext: Buffer; nonce: Buffer } | undefined;
  if (!row) throw new Error("credential not found");
  const plaintext = decryptToken(row.ciphertext, row.nonce);
  db.prepare("UPDATE scan_credentials SET last_used_at = datetime('now') WHERE id = ?").run(id);
  return plaintext;
}
