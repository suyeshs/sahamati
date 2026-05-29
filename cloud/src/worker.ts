/**
 * Sahamati Cloud Worker
 *
 * Cloudflare Worker serving:
 * - Web portal (Google OAuth login, project/doc viewer)
 * - Sync API (push/pull between desktop apps and D1)
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { syncRoutes } from "./routes/sync";
import { authRoutes } from "./routes/auth";
import { portalRoutes } from "./routes/portal";
import { apiRoutes } from "./routes/api";
import { adminRoutes } from "./routes/admin";
import { authMiddleware } from "./middleware/auth";
import type { AuthUser } from "./middleware/auth";

export type Env = {
  DB: D1Database;
  KV: KVNamespace;
  PROJECT_SYNC: DurableObjectNamespace;
  ASSETS: Fetcher;
  SYNC_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  ENVIRONMENT: string;
  GCS_BUCKET: string;
  GCS_SERVICE_ACCOUNT_KEY: string;
};

export type Variables = {
  user: AuthUser;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", cors());

// Health check
app.get("/api/health", (c) =>
  c.json({ status: "ok", environment: c.env.ENVIRONMENT })
);

// Sync API (Bearer token auth)
app.route("/api/sync", syncRoutes);

// Google OAuth flow
app.route("/auth", authRoutes);

// Protected web portal pages
app.use("/portal/*", authMiddleware);
app.route("/portal", portalRoutes);

// Protected JSON API for portal
app.use("/api/portal/*", authMiddleware);
app.route("/api/portal", apiRoutes);

// Protected admin API (whitelist management)
app.use("/api/admin/*", authMiddleware);
app.route("/api/admin", adminRoutes);

// Documentation portal — MkDocs static site served from cloud/public/docs/
// via the ASSETS binding, gated behind the same sahamati_session cookie.
app.get("/docs", (c) => c.redirect("/docs/", 302));
app.use("/docs/*", authMiddleware);
app.get("/docs/*", (c) => c.env.ASSETS.fetch(c.req.raw));

// Root — redirect to portal or login
app.get("/", (c) => c.redirect("/portal"));

export default app;

// Re-export Durable Object
export { ProjectSyncDO } from "./durable/project-sync";
