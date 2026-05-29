// KMS-backed secrets bootstrap. Runs once at startup, before route mounting,
// to pull application secrets from sahamati-kms and inject them into the
// environment. Mirrors saans-v2/backend/src/config.py::_bootstrap_secrets_from_kms.
//
// Behaviour:
// - If KMS_URL or KMS_AUTH_TOKEN is unset, this is a no-op and existing .env
//   values are used. This keeps local dev frictionless.
// - If an env var is already set locally (.env override), KMS is not consulted
//   for that one — operators can pin a single secret without losing the rest.
// - The Vertex SA JSON is handled specially: it's not an env var (multi-line
//   JSON), it's parsed and made available via getVertexSACredentials() for
//   google-ai-client.ts to pass to the SDK without ever touching disk.
// - Per-secret failures log a warning and continue; bootstrap does not crash
//   the server if one secret is unavailable.

import { KMSClient, KMSClientError } from "./kms-client.js";

interface EnvSecretSpec {
  /** KMS `key_type` to look up via get_active_secret. */
  keyType: string;
  /** Environment variable to populate with the plaintext secret. */
  envVar: string;
}

const ENV_SECRETS: EnvSecretSpec[] = [
  { keyType: "anthropic_api_key", envVar: "ANTHROPIC_API_KEY" },
  { keyType: "cloudflare_sync_secret", envVar: "CLOUDFLARE_SYNC_SECRET" },
  { keyType: "github_oauth_secret", envVar: "GITHUB_CLIENT_SECRET" },
  { keyType: "google_oauth_secret", envVar: "GOOGLE_CLIENT_SECRET" },
];

const VERTEX_SA_KEY_TYPE = "vertex_sa_json";

let vertexSACredentials: Record<string, unknown> | null = null;

export function getVertexSACredentials(): Record<string, unknown> | null {
  return vertexSACredentials;
}

export async function bootstrapSecretsFromKMS(): Promise<void> {
  const kmsUrl = (process.env.KMS_URL ?? "").trim();
  const kmsToken = (process.env.KMS_AUTH_TOKEN ?? "").trim();

  if (!kmsUrl || !kmsToken) {
    console.log("[kms] KMS_URL or KMS_AUTH_TOKEN not set — skipping, using local .env secrets");
    return;
  }

  const appName = (process.env.KMS_APP_NAME ?? "").trim();
  if (!appName) {
    console.warn("[kms] KMS_APP_NAME not set — refusing to bootstrap without an explicit app scope");
    return;
  }

  const client = new KMSClient({ baseUrl: kmsUrl, authToken: kmsToken });

  let fetched = 0;
  for (const spec of ENV_SECRETS) {
    if (process.env[spec.envVar]) {
      console.log(`[kms] ${spec.envVar} already set in env — skipping KMS lookup`);
      continue;
    }
    try {
      const secret = await client.getActiveSecret(appName, spec.keyType);
      process.env[spec.envVar] = secret;
      fetched++;
      console.log(`[kms] loaded ${spec.envVar} from key_type=${spec.keyType}`);
    } catch (err) {
      const msg = err instanceof KMSClientError ? err.message : String(err);
      console.warn(`[kms] could not fetch ${spec.envVar} (key_type=${spec.keyType}): ${msg}`);
    }
  }

  // Vertex SA JSON — parsed into memory, never written to disk.
  // Skip if GOOGLE_APPLICATION_CREDENTIALS already points at a file (local override).
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      const raw = await client.getActiveSecret(appName, VERTEX_SA_KEY_TYPE);
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") {
        throw new Error("missing client_email or private_key fields");
      }
      vertexSACredentials = parsed;
      fetched++;
      console.log(`[kms] loaded Vertex SA credentials from key_type=${VERTEX_SA_KEY_TYPE}`);
    } catch (err) {
      const msg = err instanceof KMSClientError ? err.message : (err as Error).message;
      console.warn(`[kms] could not fetch Vertex SA JSON (key_type=${VERTEX_SA_KEY_TYPE}): ${msg}`);
    }
  } else {
    console.log("[kms] GOOGLE_APPLICATION_CREDENTIALS already set — skipping KMS Vertex SA lookup");
  }

  console.log(`[kms] bootstrap complete: ${fetched} secret(s) loaded from app=${appName}`);
}
