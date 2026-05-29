/**
 * Auth middleware — validates session cookie against KV
 * Also resolves user DB record (id, role) for downstream use.
 */
import { createMiddleware } from "hono/factory";
import type { Env } from "../worker";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  picture: string;
  globalRole: string; // 'admin' | 'member'
};

type Variables = {
  user: AuthUser;
};

export const authMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: Variables;
}>(async (c, next) => {
  const sessionId = getCookie(c.req.raw, "sahamati_session");

  if (!sessionId) {
    if (c.req.path.startsWith("/api/")) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return c.redirect("/auth/login");
  }

  const sessionData = await c.env.KV.get(`session:${sessionId}`, "json");
  if (!sessionData) {
    if (c.req.path.startsWith("/api/")) {
      return c.json({ error: "Session expired" }, 401);
    }
    return c.redirect("/auth/login");
  }

  const session = sessionData as { email: string; name: string; picture: string };

  // Resolve user's DB record to get their id and global role
  const userRow = await c.env.DB.prepare(
    "SELECT id, role FROM users WHERE email = ?"
  ).bind(session.email).first<{ id: string; role: string }>();

  const user: AuthUser = {
    id: userRow?.id ?? "",
    email: session.email,
    name: session.name,
    picture: session.picture,
    globalRole: userRow?.role ?? "member",
  };

  c.set("user", user);
  await next();
});

function getCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}
