import { Hono } from "hono";
import { ensureUser, getUserByEmail, updateUserRole, listUsers } from "../db/repositories/user-repo.js";
import { pullFromCloud } from "../sync/sync-engine.js";
import { authMiddleware, getVerifiedClaims } from "../middleware/auth-middleware.js";
import type { AppEnv } from "../types.js";

const users = new Hono<AppEnv>();

// Ensure user exists (called after login). This is the bootstrap call, so it
// cannot require an existing user row — but it still requires a verified Google
// token, and the user's identity is taken from the token's claims, not the body.
// Also triggers a cloud pull so any web-created users, project memberships,
// and documents are synced down to the desktop app.
users.post("/api/users/ensure", async (c) => {
  const claims = await getVerifiedClaims(c);
  if (!claims) {
    return c.json({ error: "Authentication required" }, 401);
  }
  const email = claims.email;
  const name = claims.name;
  const picture = claims.picture;

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

// Get current user — identity from the verified token.
users.get("/api/users/me", authMiddleware, (c) => {
  return c.json({ user: c.get("user") });
});

// List all users (for adding members)
users.get("/api/users", authMiddleware, (c) => {
  const allUsers = listUsers();
  return c.json({ users: allUsers });
});

// Update user role (admin only)
users.put("/api/users/:id/role", authMiddleware, async (c) => {
  if (c.get("userRole") !== "admin") {
    return c.json({ error: "Admin role required" }, 403);
  }

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
