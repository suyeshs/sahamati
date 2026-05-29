import { randomUUID } from "crypto";
import { getDb } from "../index.js";

export interface User {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  role: string;
  totp_secret: string | null;
  totp_enabled: number;
  created_at: string;
  updated_at: string;
}

export function ensureUser(email: string, name: string, picture?: string): User {
  const db = getDb();

  const existing = db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email) as User | undefined;

  if (existing) {
    // Update name and picture if changed
    if (existing.name !== name || existing.picture !== (picture ?? null)) {
      db.prepare(
        "UPDATE users SET name = ?, picture = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(name, picture ?? null, existing.id);
      return { ...existing, name, picture: picture ?? null };
    }
    return existing;
  }

  const id = randomUUID();
  db.prepare(
    "INSERT INTO users (id, email, name, picture) VALUES (?, ?, ?, ?)"
  ).run(id, email, name, picture ?? null);

  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as User;
}

export function getUserById(id: string): User | undefined {
  return getDb()
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(id) as User | undefined;
}

export function getUserByEmail(email: string): User | undefined {
  return getDb()
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email) as User | undefined;
}

export function updateUserRole(id: string, role: string): void {
  getDb()
    .prepare("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?")
    .run(role, id);
}

export function listUsers(): User[] {
  return getDb().prepare("SELECT * FROM users ORDER BY name").all() as User[];
}

export function setTotpSecret(id: string, secret: string): void {
  getDb()
    .prepare("UPDATE users SET totp_secret = ?, updated_at = datetime('now') WHERE id = ?")
    .run(secret, id);
}

export function enableTotp(id: string): void {
  getDb()
    .prepare("UPDATE users SET totp_enabled = 1, updated_at = datetime('now') WHERE id = ?")
    .run(id);
}

export function disableTotp(id: string): void {
  getDb()
    .prepare("UPDATE users SET totp_enabled = 0, totp_secret = NULL, updated_at = datetime('now') WHERE id = ?")
    .run(id);
}
