import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { AUTH_CONFIG } from "./config.js";
import { generateState } from "./pkce.js";
import {
  createPendingSession,
  getPendingSession,
  getPendingSessionByState,
  updateSessionResult,
  updateSessionError,
  deleteSession,
} from "./session-store.js";
import {
  storeGitHubToken,
  getGitHubToken,
  removeGitHubToken,
  hasGitHubToken,
} from "./github-store.js";
import { authMiddleware } from "../middleware/auth-middleware.js";
import type { AppEnv } from "../types.js";

const githubRoutes = new Hono<AppEnv>();

/**
 * GET /auth/github/start
 * Initiates GitHub OAuth flow. Accepts ?email= query param to associate the token.
 * Returns { authUrl, sessionId } for the client to open and poll.
 */
githubRoutes.get("/auth/github/start", authMiddleware, (c) => {
  if (!AUTH_CONFIG.githubClientId || !AUTH_CONFIG.githubClientSecret) {
    return c.json(
      { error: "GitHub OAuth not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET." },
      500
    );
  }

  const email = c.get("userEmail");

  const sessionId = randomUUID();
  // Encode email into the state so the callback can associate the token
  const statePayload = `${generateState()}:${Buffer.from(email).toString("base64url")}`;

  createPendingSession({
    sessionId,
    state: statePayload,
    nonce: "",
    codeVerifier: "",
    createdAt: Date.now(),
    result: null,
    error: null,
  });

  const params = new URLSearchParams({
    client_id: AUTH_CONFIG.githubClientId,
    redirect_uri: AUTH_CONFIG.githubCallbackUrl,
    scope: "repo read:user read:org",
    state: statePayload,
  });

  const authUrl = `${AUTH_CONFIG.githubAuthEndpoint}?${params.toString()}`;

  return c.json({ authUrl, sessionId });
});

/**
 * GET /auth/github/callback
 * GitHub redirects here after user authorizes. Exchanges code for access token.
 */
githubRoutes.get("/auth/github/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  if (error) {
    if (state) {
      const session = getPendingSessionByState(state);
      if (session) {
        updateSessionError(session.sessionId, `GitHub auth error: ${error}`);
      }
    }
    return c.html(resultPage(false, `Authentication failed: ${error}`));
  }

  if (!code || !state) {
    return c.html(resultPage(false, "Missing code or state parameter"));
  }

  const session = getPendingSessionByState(state);
  if (!session) {
    return c.html(resultPage(false, "Invalid or expired session. Please try again."));
  }

  if (Date.now() - session.createdAt > AUTH_CONFIG.sessionTtlMs) {
    deleteSession(session.sessionId);
    return c.html(resultPage(false, "Session expired. Please try again."));
  }

  // Extract email from state
  const stateParts = state.split(":");
  const email = stateParts.length > 1
    ? Buffer.from(stateParts[stateParts.length - 1], "base64url").toString("utf-8")
    : null;

  if (!email) {
    updateSessionError(session.sessionId, "Could not determine user email from state");
    return c.html(resultPage(false, "Could not determine user. Please try again."));
  }

  try {
    // Exchange code for access token
    const tokenResponse = await fetch(AUTH_CONFIG.githubTokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: AUTH_CONFIG.githubClientId,
        client_secret: AUTH_CONFIG.githubClientSecret,
        code,
        redirect_uri: AUTH_CONFIG.githubCallbackUrl,
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed: ${tokenResponse.status}`);
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (tokenData.error || !tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || "No access token received");
    }

    // Fetch GitHub user info
    const userResponse = await fetch(`${AUTH_CONFIG.githubApiBase}/user`, {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: "application/vnd.github+json",
      },
    });

    if (!userResponse.ok) {
      throw new Error(`Failed to fetch GitHub user: ${userResponse.status}`);
    }

    const userData = (await userResponse.json()) as { login: string; name?: string };

    // Store the token keyed by email
    storeGitHubToken(email, tokenData.access_token, userData.login);

    // Update the polling session with success
    updateSessionResult(session.sessionId, {
      token: "",  // We don't expose the GitHub token to the client
      user: {
        email,
        name: userData.login,
        picture: "",
        domain: "github.com",
      },
      expiresAt: 0,
    });

    return c.html(
      resultPage(true, `GitHub connected as @${userData.login}. You can close this tab and return to the app.`)
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error during GitHub authentication";
    updateSessionError(session.sessionId, message);
    return c.html(resultPage(false, message));
  }
});

/**
 * GET /auth/github/poll/:sessionId
 * Client polls this to check if GitHub OAuth has completed.
 */
githubRoutes.get("/auth/github/poll/:sessionId", (c) => {
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
    const username = session.result.user.name;
    deleteSession(sessionId);
    return c.json({ status: "complete", data: { username, connected: true } });
  }

  return c.json({ status: "pending" });
});

/**
 * GET /auth/github/status
 * Check if a user has GitHub connected. Accepts ?email= query param.
 */
githubRoutes.get("/auth/github/status", authMiddleware, (c) => {
  const email = c.get("userEmail");
  const connection = getGitHubToken(email);
  if (connection) {
    return c.json({ connected: true, username: connection.username });
  }

  return c.json({ connected: false });
});

/**
 * POST /auth/github/disconnect
 * Remove stored GitHub token for a user.
 */
githubRoutes.post("/auth/github/disconnect", authMiddleware, async (c) => {
  removeGitHubToken(c.get("userEmail"));
  return c.json({ status: "ok" });
});

function resultPage(success: boolean, message: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Sahamati - GitHub</title>
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
    <h2>${success ? "Connected" : "Error"}</h2>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

export default githubRoutes;
