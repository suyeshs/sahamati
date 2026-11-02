// KMS secrets management — proxies to sahamati-kms so internal admins can
// generate, list, rotate, and mint service tokens without using the KMS
// admin UI directly. All endpoints require a logged-in user with the
// global `admin` role.
//
// We deliberately do NOT persist returned secrets/tokens anywhere in this
// process. The KMS plaintext only flows back to the caller; the React UI
// is responsible for "show once and discard" handling.

import { Hono } from "hono";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppEnv } from "../types.js";
import { authMiddleware } from "../middleware/auth-middleware.js";
import { requireAdmin } from "../middleware/rbac-middleware.js";
import { KMSClient, KMSClientError } from "../services/kms-client.js";
import { runSecretOrchestrator } from "../orchestrator.js";

const secrets = new Hono<AppEnv>();

function getKmsClient(): KMSClient | null {
  const baseUrl = (process.env.KMS_URL ?? "").trim();
  const authToken = (process.env.KMS_AUTH_TOKEN ?? "").trim();
  if (!baseUrl || !authToken) return null;
  return new KMSClient({ baseUrl, authToken });
}

/** Map a KMSClientError to a JSON response. We pass through the upstream
 * status when we can parse it from the message ("KMS ... error 422: ..."),
 * otherwise default to 502 (bad upstream). */
function kmsErrorResponse(c: Context<AppEnv>, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/error (\d{3})/);
  const status = m ? Number(m[1]) : 502;
  return c.json({ error: "kms_error", detail: msg }, status as 400 | 401 | 403 | 404 | 422 | 502);
}

function ensureKms(c: Context<AppEnv>): KMSClient | Response {
  const client = getKmsClient();
  if (!client) {
    return c.json(
      {
        error: "kms_not_configured",
        detail: "KMS_URL and KMS_AUTH_TOKEN must be set on the agent-server to manage secrets.",
      },
      503,
    );
  }
  return client;
}

// --- Keys ---------------------------------------------------------------

secrets.get("/api/secrets", authMiddleware, async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;
  const clientOrResp = ensureKms(c);
  if (!(clientOrResp instanceof KMSClient)) return clientOrResp;

  const appName = c.req.query("app_name") || undefined;
  try {
    const keys = await clientOrResp.listKeys(appName);
    return c.json({ keys });
  } catch (err) {
    if (err instanceof KMSClientError) return kmsErrorResponse(c, err);
    throw err;
  }
});

secrets.post("/api/secrets/generate", authMiddleware, async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;
  const clientOrResp = ensureKms(c);
  if (!(clientOrResp instanceof KMSClient)) return clientOrResp;

  const body = (await c.req.json().catch(() => ({}))) as {
    app_name?: string;
    key_type?: string;
    description?: string;
    expires_in_days?: number;
  };
  if (!body.app_name || !body.key_type) {
    return c.json({ error: "app_name and key_type are required" }, 400);
  }
  try {
    const result = await clientOrResp.generateKey({
      appName: body.app_name,
      keyType: body.key_type,
      description: body.description,
      expiresInDays: body.expires_in_days,
    });
    return c.json(result, 201);
  } catch (err) {
    if (err instanceof KMSClientError) return kmsErrorResponse(c, err);
    throw err;
  }
});

secrets.post("/api/secrets/:key_id/rotate", authMiddleware, async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;
  const clientOrResp = ensureKms(c);
  if (!(clientOrResp instanceof KMSClient)) return clientOrResp;

  const keyId = c.req.param("key_id");
  const body = (await c.req.json().catch(() => ({}))) as { grace_period_days?: number };
  try {
    const result = await clientOrResp.rotateKey(keyId, body.grace_period_days);
    return c.json(result);
  } catch (err) {
    if (err instanceof KMSClientError) return kmsErrorResponse(c, err);
    throw err;
  }
});

// --- Service tokens -----------------------------------------------------

secrets.get("/api/secrets/service-tokens", authMiddleware, async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;
  const clientOrResp = ensureKms(c);
  if (!(clientOrResp instanceof KMSClient)) return clientOrResp;

  const appName = c.req.query("app_name") || undefined;
  try {
    const tokens = await clientOrResp.listServiceTokens(appName);
    return c.json({ tokens });
  } catch (err) {
    if (err instanceof KMSClientError) return kmsErrorResponse(c, err);
    throw err;
  }
});

secrets.post("/api/secrets/service-tokens", authMiddleware, async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;
  const clientOrResp = ensureKms(c);
  if (!(clientOrResp instanceof KMSClient)) return clientOrResp;

  const body = (await c.req.json().catch(() => ({}))) as {
    app_name?: string;
    description?: string;
  };
  if (!body.app_name) {
    return c.json({ error: "app_name is required" }, 400);
  }
  try {
    const result = await clientOrResp.createServiceToken({
      appName: body.app_name,
      description: body.description,
    });
    return c.json(result, 201);
  } catch (err) {
    if (err instanceof KMSClientError) return kmsErrorResponse(c, err);
    throw err;
  }
});

// --- Assistant (agent-driven workflow) -----------------------------------

/** The agent calls back into this same agent-server. In dev that's typically
 * http://127.0.0.1:3001; in prod it may be different. Configurable via env. */
function selfBaseUrl(): string {
  const fromEnv = (process.env.AGENT_SERVER_SELF_URL ?? "").trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  const port = (process.env.PORT ?? "3001").trim();
  return `http://127.0.0.1:${port}`;
}

secrets.post("/api/secrets/assistant", authMiddleware, async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;

  const body = (await c.req.json().catch(() => ({}))) as { prompt?: string; sessionId?: string };
  if (!body.prompt || !body.prompt.trim()) {
    return c.json({ error: "prompt is required" }, 400);
  }

  const userEmail = c.get("userEmail") as string;
  const sessionId = body.sessionId;
  const userPrompt = body.prompt.trim();
  const agentServerUrl = selfBaseUrl();

  return streamSSE(c, async (stream) => {
    let id = 0;
    const writeEvent = async (event: string, data: unknown) => {
      await stream.writeSSE({ id: String(id++), event, data: JSON.stringify(data) });
    };

    try {
      await runSecretOrchestrator(userPrompt, {
        userEmail,
        agentServerUrl,
        sessionId,
        onMessage: async (msg) => {
          await writeEvent("message", msg);
        },
      });
      await writeEvent("done", { status: "completed" });
    } catch (err) {
      await writeEvent("error", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
});

export default secrets;
