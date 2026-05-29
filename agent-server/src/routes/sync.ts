import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth-middleware.js";
import { syncWithCloud, getLastSyncTimestamp, getPendingChanges, seedSyncLog, resetSyncLog } from "../sync/sync-engine.js";
import type { AppEnv } from "../types.js";

const sync = new Hono<AppEnv>();

// Trigger a full sync cycle
sync.post("/api/sync", authMiddleware, async (c) => {
  const cloudflareUrl = process.env.CLOUDFLARE_SYNC_URL;
  const syncSecret = process.env.CLOUDFLARE_SYNC_SECRET;

  if (!cloudflareUrl || !syncSecret) {
    return c.json({ error: "Cloud sync not configured. Set CLOUDFLARE_SYNC_URL and CLOUDFLARE_SYNC_SECRET." }, 503);
  }

  const result = await syncWithCloud(cloudflareUrl, syncSecret);
  return c.json({ success: true, ...result });
});

// Initial full sync — seed all existing data into sync log, then push
sync.post("/api/sync/full", authMiddleware, async (c) => {
  const cloudflareUrl = process.env.CLOUDFLARE_SYNC_URL;
  const syncSecret = process.env.CLOUDFLARE_SYNC_SECRET;

  if (!cloudflareUrl || !syncSecret) {
    return c.json({ error: "Cloud sync not configured." }, 503);
  }

  const body = await c.req.json().catch(() => ({}));
  const force = (body as { force?: boolean }).force;
  if (force) resetSyncLog();

  const seeded = seedSyncLog();
  const result = await syncWithCloud(cloudflareUrl, syncSecret);
  return c.json({ success: true, seeded, ...result });
});

// Get sync status
sync.get("/api/sync/status", authMiddleware, (c) => {
  const lastSync = getLastSyncTimestamp();
  const pending = getPendingChanges(0); // count only

  return c.json({
    lastSync,
    pendingChanges: pending.length,
    cloudConfigured: !!(process.env.CLOUDFLARE_SYNC_URL && process.env.CLOUDFLARE_SYNC_SECRET),
  });
});

export default sync;
