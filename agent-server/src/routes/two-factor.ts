import { Hono } from "hono";
import {
  getUserByEmail,
  setTotpSecret,
  enableTotp,
  disableTotp,
} from "../db/repositories/user-repo.js";
import { generateTotpSecret, buildTotpUri, verifyTotpCode } from "../auth/totp.js";

const twoFactor = new Hono();

/**
 * GET /api/2fa/status?email=...
 * Returns whether 2FA is enabled for the user.
 */
twoFactor.get("/api/2fa/status", (c) => {
  const email = c.req.query("email") || c.req.header("X-User-Email");
  if (!email) return c.json({ error: "email required" }, 400);

  const user = getUserByEmail(email);
  if (!user) return c.json({ error: "User not found" }, 404);

  return c.json({ enabled: !!user.totp_enabled });
});

/**
 * POST /api/2fa/setup
 * Generate a new TOTP secret and return the provisioning URI.
 * Body: { email: string }
 */
twoFactor.post("/api/2fa/setup", async (c) => {
  const { email } = await c.req.json<{ email: string }>();
  if (!email) return c.json({ error: "email required" }, 400);

  const user = getUserByEmail(email);
  if (!user) return c.json({ error: "User not found" }, 404);

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
  const { email, code } = await c.req.json<{ email: string; code: string }>();
  if (!email || !code) return c.json({ error: "email and code required" }, 400);

  const user = getUserByEmail(email);
  if (!user) return c.json({ error: "User not found" }, 404);

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
  const { email, code } = await c.req.json<{ email: string; code: string }>();
  if (!email || !code) return c.json({ error: "email and code required" }, 400);

  const user = getUserByEmail(email);
  if (!user) return c.json({ error: "User not found" }, 404);

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
  const { email, code } = await c.req.json<{ email: string; code: string }>();
  if (!email || !code) return c.json({ error: "email and code required" }, 400);

  const user = getUserByEmail(email);
  if (!user) return c.json({ error: "User not found" }, 404);

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
