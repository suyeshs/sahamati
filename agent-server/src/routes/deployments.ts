import { Hono } from "hono";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppEnv, DeploymentCreateRequest } from "../types.js";
import { authMiddleware } from "../middleware/auth-middleware.js";
import { requireProjectPermission } from "../middleware/rbac-middleware.js";
import {
  getDeployment,
  listDeployments,
  listBindings,
  listEvents,
} from "../db/repositories/deployment-repo.js";
import {
  startDeployment,
  teardownDeployment,
} from "../services/deployment-service.js";
import { getCloudflareConfig } from "../cloudflare/client.js";

/**
 * Tenant-app deployments to Cloudflare Workers for Platforms.
 *
 * MVP gate: only @sahamati.org.in users can hit these routes. The auth
 * middleware already requires a logged-in user; the email-domain check is
 * here so a misconfigured user record can't sneak through.
 *
 * Permissions: deploy/teardown require `edit-project` (owner + lead).
 * List/get require `view-project`.
 */

const deployments = new Hono<AppEnv>();

function requireSahamatiInternal(c: Context<AppEnv>): Response | null {
  const email = c.get("userEmail") || "";
  if (!email.toLowerCase().endsWith("@sahamati.org.in")) {
    return c.json({ error: "Deployments are restricted to @sahamati.org.in users in MVP." }, 403);
  }
  return null;
}

function ensureCloudflareConfigured(c: Context<AppEnv>): Response | null {
  try {
    getCloudflareConfig();
    return null;
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 503);
  }
}

// --- Kick off a deployment ---

deployments.post(
  "/api/projects/:slug/deployments",
  authMiddleware,
  requireProjectPermission("edit-project"),
  async (c) => {
    const blocked = requireSahamatiInternal(c) ?? ensureCloudflareConfigured(c);
    if (blocked) return blocked;

    const projectId = c.get("projectId");
    const userId = c.get("userId");

    let body: DeploymentCreateRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "JSON body required" }, 400);
    }

    if (!body?.source || typeof body.source !== "object") {
      return c.json({ error: "source is required" }, 400);
    }
    if (body.source.type === "git") {
      if (typeof body.source.repoUrl !== "string" || body.source.repoUrl.length === 0) {
        return c.json({ error: "source.repoUrl is required for git sources" }, 400);
      }
    } else if (body.source.type === "tarball") {
      return c.json({ error: "tarball source is not supported in MVP" }, 400);
    } else {
      return c.json({ error: "source.type must be 'git'" }, 400);
    }

    try {
      const deployment = startDeployment({
        projectId,
        userId,
        source: body.source,
      });
      return c.json({ deployment }, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  },
);

// --- List deployments for a project ---

deployments.get(
  "/api/projects/:slug/deployments",
  authMiddleware,
  requireProjectPermission("view-project"),
  (c) => {
    const projectId = c.get("projectId");
    return c.json({ deployments: listDeployments(projectId) });
  },
);

// --- Get one deployment (with bindings + last 200 events) ---

deployments.get(
  "/api/projects/:slug/deployments/:id",
  authMiddleware,
  requireProjectPermission("view-project"),
  (c) => {
    const projectId = c.get("projectId");
    const id = c.req.param("id");
    const deployment = getDeployment(id, projectId);
    if (!deployment) return c.json({ error: "Deployment not found" }, 404);

    const events = listEvents(id).slice(-200);
    const bindings = listBindings(id);
    return c.json({ deployment, bindings, events });
  },
);

// --- SSE stream of deployment events ---

deployments.get(
  "/api/projects/:slug/deployments/:id/events",
  authMiddleware,
  requireProjectPermission("view-project"),
  (c) => {
    const projectId = c.get("projectId");
    const id = c.req.param("id");
    const deployment = getDeployment(id, projectId);
    if (!deployment) return c.json({ error: "Deployment not found" }, 404);

    return streamSSE(c, async (stream) => {
      let lastId = 0;
      let sseId = 0;
      const terminalStatuses = new Set(["live", "failed", "torn_down"]);

      // First flush: send everything so far.
      for (const ev of listEvents(id, lastId)) {
        await stream.writeSSE({
          id: String(sseId++),
          event: "event",
          data: JSON.stringify(ev),
        });
        lastId = ev.id;
      }

      // Then poll the DB. We don't have a pub/sub layer; SQLite reads are cheap
      // and the deploy is fire-and-forget in-process. 750ms strikes a balance
      // between latency and CPU. Stops when status becomes terminal.
      while (true) {
        const current = getDeployment(id, projectId);
        if (!current) break;

        const newEvents = listEvents(id, lastId);
        for (const ev of newEvents) {
          await stream.writeSSE({
            id: String(sseId++),
            event: "event",
            data: JSON.stringify(ev),
          });
          lastId = ev.id;
        }

        if (terminalStatuses.has(current.status)) {
          await stream.writeSSE({
            id: String(sseId++),
            event: "done",
            data: JSON.stringify({ status: current.status, failureReason: current.failure_reason }),
          });
          break;
        }

        await new Promise((r) => setTimeout(r, 750));
      }
    });
  },
);

// --- Tear down a deployment ---

deployments.delete(
  "/api/projects/:slug/deployments/:id",
  authMiddleware,
  requireProjectPermission("edit-project"),
  async (c) => {
    const blocked = requireSahamatiInternal(c) ?? ensureCloudflareConfigured(c);
    if (blocked) return blocked;

    const projectId = c.get("projectId");
    const id = c.req.param("id");

    try {
      const result = await teardownDeployment(id, projectId);
      if (!result) return c.json({ error: "Deployment not found" }, 404);
      return c.json({ deployment: result });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  },
);

export default deployments;
