import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { KMSClient, KMSClientError } from "../services/kms-client.js";

// The admin gate is enforced at /api/secrets/assistant before
// runSecretOrchestrator is called. By the time these handlers run, the
// invoking user has already cleared `requireAdmin`. Tools call KMS directly
// rather than looping back through the agent-server's own HTTP API.

function getKmsClient(): KMSClient {
  const baseUrl = (process.env.KMS_URL ?? "").trim();
  const authToken = (process.env.KMS_AUTH_TOKEN ?? "").trim();
  if (!baseUrl || !authToken) {
    throw new Error(
      "KMS is not configured: KMS_URL and KMS_AUTH_TOKEN must be set on the agent-server.",
    );
  }
  return new KMSClient({ baseUrl, authToken });
}

async function withKms<T>(op: (client: KMSClient) => Promise<T>): Promise<T> {
  try {
    return await op(getKmsClient());
  } catch (err) {
    if (err instanceof KMSClientError) {
      throw new Error(`KMS error: ${err.message}`);
    }
    throw err;
  }
}

function asJson(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

export const secretsMcpServer = createSdkMcpServer({
  name: "secrets",
  version: "1.0.0",
  tools: [
    tool(
      "list_keys",
      "List KMS-managed keys for an app, or across all apps if app_name is omitted.",
      { app_name: z.string().optional() },
      async ({ app_name }) =>
        asJson({ keys: await withKms((c) => c.listKeys(app_name)) }),
    ),
    tool(
      "generate_key",
      "Generate a new KMS-managed key. Returns the plaintext exactly once — surface it via the structured response only, never echo it in chat. " +
        "Call list_keys first; if an active key with the same key_type already exists, prefer rotate_key instead.",
      {
        app_name: z.string().min(1),
        key_type: z.string().min(1),
        description: z.string().optional(),
        expires_in_days: z.number().int().positive().optional(),
      },
      async ({ app_name, key_type, description, expires_in_days }) =>
        asJson(
          await withKms((c) =>
            c.generateKey({
              appName: app_name,
              keyType: key_type,
              description,
              expiresInDays: expires_in_days,
            }),
          ),
        ),
    ),
    tool(
      "rotate_key",
      "Rotate an existing KMS key. Returns the new plaintext exactly once — surface it via the structured response only.",
      {
        key_id: z.string().min(1),
        grace_period_days: z.number().int().nonnegative().optional(),
      },
      async ({ key_id, grace_period_days }) =>
        asJson(await withKms((c) => c.rotateKey(key_id, grace_period_days))),
    ),
    tool(
      "list_service_tokens",
      "List service tokens for an app, or across all apps if app_name is omitted.",
      { app_name: z.string().optional() },
      async ({ app_name }) =>
        asJson({ tokens: await withKms((c) => c.listServiceTokens(app_name)) }),
    ),
    tool(
      "mint_service_token",
      "Mint a new service token for an app. Returns the plaintext exactly once — surface it via the structured response only.",
      {
        app_name: z.string().min(1),
        description: z.string().optional(),
      },
      async ({ app_name, description }) =>
        asJson(
          await withKms((c) => c.createServiceToken({ appName: app_name, description })),
        ),
    ),
  ],
});
