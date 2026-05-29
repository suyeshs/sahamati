import { Hono } from "hono";
import { getAuthStatus, startLogin, logout } from "../claudecode/auth.js";
import { getRunnerMode } from "../runner-config.js";

const claudecodeAuth = new Hono();

/**
 * GET /api/claudecode/auth/status
 * Returns whether the local Claude CLI is logged in, and to which account.
 * No auth middleware: this endpoint reports machine-local state, not Sahamati
 * project data. The agent-server is bound to localhost from the desktop shell.
 */
claudecodeAuth.get("/api/claudecode/auth/status", async (c) => {
  const res = await getAuthStatus();
  return c.json(res);
});

/**
 * POST /api/claudecode/auth/login
 * Body: { email?: string, sso?: boolean }
 * Spawns `claude auth login`, which opens the user's browser. Returns
 * immediately — the UI should poll the status endpoint until loggedIn flips.
 */
claudecodeAuth.post("/api/claudecode/auth/login", async (c) => {
  let body: { email?: string; sso?: boolean } = {};
  try {
    body = await c.req.json();
  } catch {
    // No body is fine — default flow.
  }
  const res = startLogin(body);
  if (!res.started) return c.json(res, 500);
  return c.json(res, 202);
});

/**
 * POST /api/claudecode/auth/logout
 * Runs `claude auth logout`.
 */
claudecodeAuth.post("/api/claudecode/auth/logout", async (c) => {
  const res = await logout();
  if (!res.ok) return c.json(res, 500);
  return c.json(res);
});

/**
 * GET /api/claudecode/runner-mode
 * Returns the current agent runner mode so the UI can warn if the user is
 * logged in but the runner is still set to SDK (API credits) or vice versa.
 */
claudecodeAuth.get("/api/claudecode/runner-mode", (c) => {
  return c.json({ mode: getRunnerMode() });
});

export default claudecodeAuth;
