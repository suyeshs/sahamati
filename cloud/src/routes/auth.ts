/**
 * Google OAuth routes for web portal
 */
import { Hono } from "hono";
import type { Env } from "../worker";
import { loginPage } from "../pages/login";

const auth = new Hono<{ Bindings: Env }>();

// Login page
auth.get("/login", (c) => {
  return c.html(loginPage());
});

// Start Google OAuth
auth.get("/google", (c) => {
  const state = crypto.randomUUID();
  const workerUrl = new URL(c.req.url).origin;

  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${workerUrl}/auth/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    hd: "sahamati.org.in",
    prompt: "select_account",
  });

  // Store state in KV for validation (5 min TTL)
  c.executionCtx.waitUntil(
    c.env.KV.put(`oauth_state:${state}`, "1", { expirationTtl: 300 })
  );

  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// Google OAuth callback
auth.get("/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  if (error || !code || !state) {
    return c.html(loginPage("Authentication failed. Please try again."));
  }

  // Validate state
  const storedState = await c.env.KV.get(`oauth_state:${state}`);
  if (!storedState) {
    return c.html(loginPage("Invalid session. Please try again."));
  }
  await c.env.KV.delete(`oauth_state:${state}`);

  const workerUrl = new URL(c.req.url).origin;

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${workerUrl}/auth/callback`,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    return c.html(loginPage("Failed to exchange token. Please try again."));
  }

  const tokens = (await tokenRes.json()) as { id_token: string };

  // Decode ID token (we trust Google's response here)
  const payload = JSON.parse(
    atob(tokens.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
  ) as { email: string; name: string; picture: string; hd?: string };

  // Domain restriction
  if (payload.hd !== "sahamati.org.in") {
    return c.html(loginPage("Access restricted to @sahamati.org.in accounts."));
  }

  // Whitelist check — must be in allowed_emails
  const allowed = await c.env.DB.prepare(
    "SELECT email FROM allowed_emails WHERE email = ?"
  ).bind(payload.email).first<{ email: string }>();

  if (!allowed) {
    return c.html(
      loginPage(
        `Your account (${payload.email}) is not authorized for this portal. Contact a Sahamati admin to request access.`
      )
    );
  }

  // Create session
  const sessionId = crypto.randomUUID();
  const sessionData = {
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
  };

  // Store session (24h TTL)
  await c.env.KV.put(`session:${sessionId}`, JSON.stringify(sessionData), {
    expirationTtl: 86400,
  });

  // Ensure user exists in D1
  const now = new Date().toISOString();
  const userId = crypto.randomUUID();

  // Check if user already exists
  const existingUser = await c.env.DB.prepare(
    "SELECT id FROM users WHERE email = ?"
  ).bind(payload.email).first<{ id: string }>();

  const finalUserId = existingUser?.id ?? userId;

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO users (id, email, name, picture, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'member', ?, ?)
       ON CONFLICT(email) DO UPDATE SET name = excluded.name, picture = excluded.picture, updated_at = excluded.updated_at`
    ).bind(userId, payload.email, payload.name, payload.picture, now, now),

    // Record in sync log so desktop apps pick up the user on next pull
    c.env.DB.prepare(
      `INSERT INTO _sync_log (table_name, record_id, operation, data, timestamp, device_id)
       VALUES ('users', ?, ?, ?, ?, 'cloud')`
    ).bind(
      finalUserId,
      existingUser ? "UPDATE" : "INSERT",
      JSON.stringify({
        id: finalUserId,
        email: payload.email,
        name: payload.name,
        picture: payload.picture,
        role: "member",
        created_at: existingUser ? undefined : now,
        updated_at: now,
      }),
      now
    ),
  ]);

  // Set session cookie and redirect
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/portal",
      "Set-Cookie": `sahamati_session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`,
    },
  });
});

// Logout
auth.get("/logout", async (c) => {
  const cookie = c.req.raw.headers.get("Cookie") || "";
  const match = cookie.match(/sahamati_session=([^;]*)/);
  if (match) {
    await c.env.KV.delete(`session:${match[1]}`);
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/auth/login",
      "Set-Cookie": "sahamati_session=; Path=/; HttpOnly; Secure; Max-Age=0",
    },
  });
});

export { auth as authRoutes };
