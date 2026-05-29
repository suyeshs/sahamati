/**
 * Admin API — manage the email whitelist that gates portal sign-in.
 * All routes require the caller to have users.role = 'admin'.
 */
import { Hono } from "hono";
import type { Env, Variables } from "../worker";

const admin = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Derive a readable placeholder display name from an email local-part.
 * "ganesh.jayadevan@…" → "Ganesh Jayadevan".  Used for whitelist entries that
 * haven't signed in yet, so member pickers can show them.  The OAuth callback
 * later overwrites name/picture via ON CONFLICT(email) DO UPDATE.
 */
function placeholderNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return email;
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(" ");
}

admin.use("*", async (c, next) => {
  const user = c.get("user");
  if (!user?.id || user.globalRole !== "admin") {
    return c.json({ error: "Forbidden — admin only" }, 403);
  }
  await next();
});

admin.get("/allowed-emails", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT email, added_by, added_at, note FROM allowed_emails ORDER BY added_at DESC"
  ).all();
  return c.json({ allowedEmails: results });
});

admin.post("/allowed-emails", async (c) => {
  const user = c.get("user");
  const body = (await c.req.json()) as { email?: string; note?: string };
  const email = body.email?.trim().toLowerCase();
  if (!email) return c.json({ error: "email is required" }, 400);
  if (!email.endsWith("@sahamati.org.in")) {
    return c.json({ error: "Only @sahamati.org.in emails can be whitelisted" }, 400);
  }

  const now = new Date().toISOString();

  // Whitelist row
  await c.env.DB.prepare(
    `INSERT INTO allowed_emails (email, added_by, added_at, note)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET note = excluded.note`
  ).bind(email, user.email, now, body.note ?? null).run();

  // Placeholder users row so member pickers can pre-assign before sign-in.
  // OAuth callback's ON CONFLICT(email) DO UPDATE will fill in name/picture later.
  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(email).first<{ id: string }>();

  if (!existing) {
    const newId = crypto.randomUUID();
    const name = placeholderNameFromEmail(email);
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO users (id, email, name, picture, role, created_at, updated_at)
         VALUES (?, ?, ?, NULL, 'member', ?, ?)`
      ).bind(newId, email, name, now, now),
      // sync log so desktop apps pick up the placeholder on next pull
      c.env.DB.prepare(
        `INSERT INTO _sync_log (table_name, record_id, operation, data, timestamp, device_id)
         VALUES ('users', ?, 'INSERT', ?, ?, 'cloud')`
      ).bind(
        newId,
        JSON.stringify({
          id: newId,
          email,
          name,
          picture: null,
          role: "member",
          created_at: now,
          updated_at: now,
        }),
        now
      ),
    ]);
  }

  return c.json({ success: true, email });
});

admin.delete("/allowed-emails/:email", async (c) => {
  const email = decodeURIComponent(c.req.param("email")).trim().toLowerCase();
  if (!email) return c.json({ error: "email is required" }, 400);

  const res = await c.env.DB.prepare("DELETE FROM allowed_emails WHERE email = ?")
    .bind(email).run();

  return c.json({ success: true, removed: res.meta?.changes ?? 0 });
});

export { admin as adminRoutes };
