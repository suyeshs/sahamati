import type { Context, Next } from "hono";
import { getUserByEmail } from "../db/repositories/user-repo.js";
import { verifySessionToken, type GoogleIdTokenPayload } from "../auth/token.js";
import type { AppEnv } from "../types.js";

/**
 * Extract the bearer token from a request. Prefers the Authorization header;
 * falls back to a `token` query parameter for EventSource/SSE clients, which
 * cannot set custom headers.
 */
function extractToken(c: Context<AppEnv>): string | undefined {
  const authz = c.req.header("Authorization");
  if (authz && authz.startsWith("Bearer ")) {
    return authz.slice("Bearer ".length).trim();
  }
  return c.req.query("token") || undefined;
}

/**
 * Verify the request's bearer token and return its claims, or null if absent or
 * invalid. Identity is taken exclusively from the verified Google ID token — a
 * client-supplied email header/param is never trusted for authentication.
 */
export async function getVerifiedClaims(
  c: Context<AppEnv>
): Promise<GoogleIdTokenPayload | null> {
  const token = extractToken(c);
  if (!token) return null;
  try {
    return await verifySessionToken(token);
  } catch {
    return null;
  }
}

/**
 * Standard guard for routes that act on an existing Sahamati user: require a
 * valid token AND a matching user row. Populates the request context with the
 * verified identity for downstream handlers.
 */
export async function authMiddleware(c: Context<AppEnv>, next: Next) {
  const claims = await getVerifiedClaims(c);
  if (!claims) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const user = getUserByEmail(claims.email);
  if (!user) {
    return c.json({ error: "User not found. Please log in first." }, 401);
  }

  c.set("user", user);
  c.set("userId", user.id);
  c.set("userEmail", user.email);
  c.set("userRole", user.role);

  await next();
}
