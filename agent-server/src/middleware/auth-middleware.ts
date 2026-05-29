import type { Context, Next } from "hono";
import { getUserByEmail } from "../db/repositories/user-repo.js";
import type { AppEnv } from "../types.js";

export async function authMiddleware(c: Context<AppEnv>, next: Next) {
  const email =
    c.req.query("email") ||
    c.req.header("X-User-Email");

  if (!email) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const user = getUserByEmail(email);
  if (!user) {
    return c.json({ error: "User not found. Please log in first." }, 401);
  }

  c.set("user", user);
  c.set("userId", user.id);
  c.set("userEmail", user.email);
  c.set("userRole", user.role);

  await next();
}
