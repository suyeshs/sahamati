import { Hono } from "hono";
import { ensureUser, getUserByEmail, updateUserRole, listUsers } from "../db/repositories/user-repo.js";
import { pullFromCloud } from "../sync/sync-engine.js";

const users = new Hono();

// Ensure user exists (called after login)
// Also triggers a cloud pull so any web-created users, project memberships,
// and documents are synced down to the desktop app.
users.post("/api/users/ensure", async (c) => {
  const { email, name, picture } = await c.req.json();

  if (!email || !name) {
    return c.json({ error: "email and name are required" }, 400);
  }

  // Pull from cloud first so we get any users/memberships created via web portal
  const cloudUrl = process.env.CLOUDFLARE_SYNC_URL;
  const syncSecret = process.env.CLOUDFLARE_SYNC_SECRET;
  let pulled = 0;
  if (cloudUrl && syncSecret) {
    try {
      const changes = await pullFromCloud(cloudUrl, syncSecret);
      pulled = changes.length;
    } catch (err) {
      console.warn("Cloud pull on login failed (non-fatal):", err);
    }
  }

  const user = ensureUser(email, name, picture);
  return c.json({ user, synced: pulled });
});

// Get current user
users.get("/api/users/me", (c) => {
  const email = c.req.query("email") || c.req.header("X-User-Email");
  if (!email) {
    return c.json({ error: "email required" }, 400);
  }

  const user = getUserByEmail(email);
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json({ user });
});

// List all users (for adding members)
users.get("/api/users", (c) => {
  const allUsers = listUsers();
  return c.json({ users: allUsers });
});

// Update user role (admin only)
users.put("/api/users/:id/role", async (c) => {
  const { id } = c.req.param();
  const { role } = await c.req.json();

  const validRoles = ["admin", "tech-lead", "developer", "marketing", "management", "viewer"];
  if (!validRoles.includes(role)) {
    return c.json({ error: `Invalid role. Must be one of: ${validRoles.join(", ")}` }, 400);
  }

  updateUserRole(id, role);
  return c.json({ success: true });
});

export default users;
