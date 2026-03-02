import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { AUTH_CONFIG } from "./config.js";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  generateNonce,
} from "./pkce.js";
import {
  createPendingSession,
  getPendingSession,
  getPendingSessionByState,
  updateSessionResult,
  updateSessionError,
  deleteSession,
} from "./session-store.js";
import { exchangeCodeForTokens, verifyIdToken } from "./token.js";

const authRoutes = new Hono();

/**
 * GET /auth/start
 * Initiates the OAuth flow. Returns the Google authorization URL and a sessionId for polling.
 */
authRoutes.get("/auth/start", (c) => {
  if (!AUTH_CONFIG.googleClientId || !AUTH_CONFIG.googleClientSecret) {
    return c.json(
      { error: "Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET." },
      500
    );
  }

  const sessionId = randomUUID();
  const state = generateState();
  const nonce = generateNonce();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  createPendingSession({
    sessionId,
    state,
    nonce,
    codeVerifier,
    createdAt: Date.now(),
    result: null,
    error: null,
  });

  const params = new URLSearchParams({
    client_id: AUTH_CONFIG.googleClientId,
    redirect_uri: AUTH_CONFIG.callbackUrl,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    hd: AUTH_CONFIG.allowedDomain,
    access_type: "offline",
    prompt: "consent",
  });

  const authUrl = `${AUTH_CONFIG.googleAuthEndpoint}?${params.toString()}`;

  return c.json({ authUrl, sessionId });
});

/**
 * GET /auth/google/callback
 * Google redirects here after user authenticates.
 */
authRoutes.get("/auth/google/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  if (error) {
    if (state) {
      const session = getPendingSessionByState(state);
      if (session) {
        updateSessionError(session.sessionId, `Google auth error: ${error}`);
      }
    }
    return c.html(authResultPage(false, `Authentication failed: ${error}`));
  }

  if (!code || !state) {
    return c.html(authResultPage(false, "Missing code or state parameter"));
  }

  const session = getPendingSessionByState(state);
  if (!session) {
    return c.html(
      authResultPage(false, "Invalid or expired session. Please try again.")
    );
  }

  if (Date.now() - session.createdAt > AUTH_CONFIG.sessionTtlMs) {
    deleteSession(session.sessionId);
    return c.html(authResultPage(false, "Session expired. Please try again."));
  }

  try {
    const tokens = await exchangeCodeForTokens(code, session.codeVerifier);
    const claims = await verifyIdToken(tokens.id_token, session.nonce);

    const result = {
      token: tokens.id_token,
      user: {
        email: claims.email,
        name: claims.name,
        picture: claims.picture,
        domain: claims.hd,
      },
      expiresAt: claims.exp,
    };

    updateSessionResult(session.sessionId, result);

    return c.html(
      authResultPage(
        true,
        "Authentication successful! You can close this tab and return to the app."
      )
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error during authentication";
    updateSessionError(session.sessionId, message);
    return c.html(authResultPage(false, message));
  }
});

/**
 * GET /auth/poll/:sessionId
 * Frontend polls this to check if authentication has completed.
 */
authRoutes.get("/auth/poll/:sessionId", (c) => {
  const { sessionId } = c.req.param();
  const session = getPendingSession(sessionId);

  if (!session) {
    return c.json({ status: "error", error: "Session not found or expired" }, 404);
  }

  if (session.error) {
    const error = session.error;
    deleteSession(sessionId);
    return c.json({ status: "error", error });
  }

  if (session.result) {
    const data = session.result;
    deleteSession(sessionId);
    return c.json({ status: "complete", data });
  }

  return c.json({ status: "pending" });
});

/**
 * POST /auth/refresh
 * Google ID tokens can't be refreshed client-side. Return 401 to signal re-auth needed.
 */
authRoutes.post("/auth/refresh", (c) => {
  return c.json({ error: "Re-authentication required" }, 401);
});

/**
 * POST /auth/logout
 * Handles logout (stateless — just returns ok).
 */
authRoutes.post("/auth/logout", (c) => {
  return c.json({ status: "ok" });
});

function authResultPage(success: boolean, message: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Sahamati - Authentication</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: #f5f5f5;
    }
    .card {
      background: white;
      border-radius: 12px;
      padding: 40px;
      text-align: center;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      max-width: 400px;
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    .success { color: #16a34a; }
    .error { color: #dc2626; }
    h2 { margin: 0 0 12px; color: #333; }
    p { color: #666; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon ${success ? "success" : "error"}">${success ? "\u2713" : "\u2717"}</div>
    <h2>${success ? "Success" : "Error"}</h2>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

export default authRoutes;
