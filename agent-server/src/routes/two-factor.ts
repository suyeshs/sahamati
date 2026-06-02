import { Hono } from "hono";
import {
  setTotpSecret,
  enableTotp,
  disableTotp,
} from "../db/repositories/user-repo.js";
import { generateTotpSecret, buildTotpUri, verifyTotpCode } from "../auth/totp.js";
import { authMiddleware } from "../middleware/auth-middleware.js";
import type { AppEnv } from "../types.js";

const twoFactor = new Hono<AppEnv>();

// All 2FA routes require a verified session token; the account they act on is
// the token's own user, never an email supplied in the request body.
twoFactor.use("/api/2fa/*", authMiddleware);

/**
 * GET /api/2fa/status
 * Returns whether 2FA is enabled for the authenticated user.
 */
twoFactor.get("/api/2fa/status", (c) => {
  const user = c.get("user");
  return c.json({ enabled: !!user.totp_enabled });
});

/**
 * POST /api/2fa/setup
 * Generate a new TOTP secret and return the provisioning URI.
 */
twoFactor.post("/api/2fa/setup", async (c) => {
  const email = c.get("userEmail");
  const user = c.get("user");

  if (user.totp_enabled) {
    return c.json({ error: "2FA is already enabled. Disable it first to reconfigure." }, 400);
  }

  const secret = generateTotpSecret();
  const uri = buildTotpUri(secret, email);

  // Store the secret (not yet enabled — user must verify first)
  setTotpSecret(user.id, secret);

  return c.json({ secret, uri });
});

/**
 * POST /api/2fa/verify
 * Verify a TOTP code and enable 2FA if valid.
 * Body: { email: string, code: string }
 */
twoFactor.post("/api/2fa/verify", async (c) => {
  const { code } = await c.req.json<{ code: string }>();
  if (!code) return c.json({ error: "code required" }, 400);

  const user = c.get("user");

  if (!user.totp_secret) {
    return c.json({ error: "No 2FA setup in progress. Call /api/2fa/setup first." }, 400);
  }

  const valid = verifyTotpCode(user.totp_secret, code);
  if (!valid) {
    return c.json({ error: "Invalid code. Please try again." }, 401);
  }

  // Enable 2FA
  enableTotp(user.id);

  return c.json({ success: true, message: "Two-factor authentication enabled." });
});

/**
 * POST /api/2fa/validate
 * Validate a TOTP code during login (does not change state).
 * Body: { email: string, code: string }
 */
twoFactor.post("/api/2fa/validate", async (c) => {
  const { code } = await c.req.json<{ code: string }>();
  if (!code) return c.json({ error: "code required" }, 400);

  const user = c.get("user");

  if (!user.totp_enabled || !user.totp_secret) {
    return c.json({ error: "2FA is not enabled for this account." }, 400);
  }

  const valid = verifyTotpCode(user.totp_secret, code);
  if (!valid) {
    return c.json({ error: "Invalid code." }, 401);
  }

  return c.json({ success: true });
});

/**
 * POST /api/2fa/disable
 * Disable 2FA. Requires a valid TOTP code for confirmation.
 * Body: { email: string, code: string }
 */
twoFactor.post("/api/2fa/disable", async (c) => {
  const { code } = await c.req.json<{ code: string }>();
  if (!code) return c.json({ error: "code required" }, 400);

  const user = c.get("user");

  if (!user.totp_enabled || !user.totp_secret) {
    return c.json({ error: "2FA is not enabled." }, 400);
  }

  const valid = verifyTotpCode(user.totp_secret, code);
  if (!valid) {
    return c.json({ error: "Invalid code. Cannot disable 2FA." }, 401);
  }

  disableTotp(user.id);

  return c.json({ success: true, message: "Two-factor authentication disabled." });
});

export default twoFactor;
