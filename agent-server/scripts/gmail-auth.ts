/**
 * One-time OAuth consent flow for the mail-e Gmail agent.
 *
 * Prints an authorization URL, catches Google's redirect on a localhost
 * loopback server, exchanges the code, and prints the refresh token to put in
 * agent-server/.env as GMAIL_REFRESH_TOKEN. Requests gmail.readonly only.
 *
 * Usage:
 *   GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... bun run scripts/gmail-auth.ts
 * or with the values already in agent-server/.env:
 *   bun run --env-file=.env scripts/gmail-auth.ts
 */

import { createServer } from "node:http";

const clientId = process.env.GMAIL_CLIENT_ID;
const clientSecret = process.env.GMAIL_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET first (Google Cloud Console → OAuth client, type: Desktop app, Gmail API enabled).");
  process.exit(1);
}

const PORT = 8976;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", SCOPE);
authUrl.searchParams.set("access_type", "offline");
// Force the consent screen so Google always issues a refresh token, even if
// this client was authorized before.
authUrl.searchParams.set("prompt", "consent");

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", REDIRECT_URI);
  if (url.pathname !== "/callback") {
    res.writeHead(404).end();
    return;
  }

  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  if (err || !code) {
    res.writeHead(400, { "Content-Type": "text/plain" }).end(`Authorization failed: ${err ?? "no code"}`);
    console.error(`Authorization failed: ${err ?? "no code returned"}`);
    server.close();
    process.exit(1);
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId!,
      client_secret: clientSecret!,
      code,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
    }),
  });
  const tokens = (await tokenRes.json()) as { refresh_token?: string; error?: string; error_description?: string };

  if (!tokenRes.ok || !tokens.refresh_token) {
    res.writeHead(500, { "Content-Type": "text/plain" }).end("Token exchange failed — see terminal.");
    console.error(`Token exchange failed: ${tokens.error ?? tokenRes.status} ${tokens.error_description ?? ""}`);
    server.close();
    process.exit(1);
  }

  res.writeHead(200, { "Content-Type": "text/plain" })
    .end("Gmail connected for mail-e. You can close this tab and return to the terminal.");

  console.log("\nAdd this to agent-server/.env (gitignored — never commit it):\n");
  console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  console.log("Then restart the agent server.");
  server.close();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log("Open this URL in a browser and sign in with your @sahamati.org.in account:\n");
  console.log(authUrl.toString() + "\n");
  console.log(`Waiting for Google to redirect to ${REDIRECT_URI} ...`);
});
