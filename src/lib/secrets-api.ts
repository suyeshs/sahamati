// Typed client for the agent-server `/api/secrets*` routes that proxy to
// sahamati-kms. Mirrors the response shapes defined in
// agent-server/src/services/kms-client.ts.

import { authHeader, handleAuthFailure } from "./auth-token";

const BASE_URL = import.meta.env.VITE_AGENT_SERVER_URL || "http://localhost:3001";

export interface KMSKeyMetadata {
  key_id: string;
  app_name: string;
  key_type: string;
  description?: string;
  status: string;
  created_by?: string;
  created_at: string;
  rotated_at?: string | null;
  expires_at?: string | null;
  kms_key_version?: string;
}

export interface KMSKeyWithSecret {
  key_id: string;
  app_name: string;
  key_type: string;
  secret: string;
  created_at: string;
  expires_at?: string | null;
}

export interface KMSRotateResult {
  old_key_id: string;
  new_key_id: string;
  new_secret: string;
  grace_period_ends: string;
}

export interface KMSServiceTokenMetadata {
  token_id: string;
  app_name: string;
  description: string;
  created_by: string;
  created_at: string;
  last_used_at: string | null;
  status: string;
}

export interface KMSServiceTokenWithValue {
  token_id: string;
  token: string;
  app_name: string;
  description: string;
  created_by: string;
  created_at: string;
}

async function apiFetch<T>(
  path: string,
  options: RequestInit & { email: string },
): Promise<T> {
  const { email, ...rest } = options;
  const sep = path.includes("?") ? "&" : "?";
  const url = `${BASE_URL}${path}${sep}email=${encodeURIComponent(email)}`;
  const res = await fetch(url, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...authHeader(),
      ...(rest.headers as Record<string, string> | undefined),
    },
  });
  handleAuthFailure(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as Record<string, unknown>);
    const detail = (body as { detail?: string; error?: string }).detail
      ?? (body as { error?: string }).error
      ?? res.statusText;
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export function listSecrets(email: string, appName?: string) {
  const qs = appName ? `?app_name=${encodeURIComponent(appName)}` : "";
  return apiFetch<{ keys: KMSKeyMetadata[] }>(`/api/secrets${qs}`, { email });
}

export function generateSecret(
  email: string,
  body: { app_name: string; key_type: string; description?: string; expires_in_days?: number },
) {
  return apiFetch<KMSKeyWithSecret>(`/api/secrets/generate`, {
    email,
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function rotateSecret(email: string, keyId: string, gracePeriodDays?: number) {
  return apiFetch<KMSRotateResult>(`/api/secrets/${encodeURIComponent(keyId)}/rotate`, {
    email,
    method: "POST",
    body: JSON.stringify({ grace_period_days: gracePeriodDays }),
  });
}

export function listServiceTokens(email: string, appName?: string) {
  const qs = appName ? `?app_name=${encodeURIComponent(appName)}` : "";
  return apiFetch<{ tokens: KMSServiceTokenMetadata[] }>(`/api/secrets/service-tokens${qs}`, { email });
}

export function createServiceToken(
  email: string,
  body: { app_name: string; description?: string },
) {
  return apiFetch<KMSServiceTokenWithValue>(`/api/secrets/service-tokens`, {
    email,
    method: "POST",
    body: JSON.stringify(body),
  });
}

// Mirror the KMS Pydantic enums so the UI shows the right dropdown defaults.
// These match keys/models.py at the time of writing — if the KMS-side enums
// change, the dropdowns may be stale, but the backend will still validate.
export const KNOWN_APP_NAMES = ["saans-v2", "anveshan", "aikya"] as const;
export const KNOWN_KEY_TYPES = [
  "jwt_secret",
  "api_key",
  "oauth_secret",
  "signing_key",
] as const;

// --- Assistant (agent-driven) ---

export interface AssistantCallbacks {
  onMessage: (msg: unknown) => void;
  onDone: () => void;
  onError: (err: string) => void;
}

/** Stream the secret-orchestrator agent's output via SSE.
 *
 * Uses fetch+ReadableStream rather than EventSource because we must send the
 * X-User-Email header (EventSource doesn't allow custom headers). Returns an
 * AbortController so the caller can cancel mid-run. */
export function runSecretAssistant(
  email: string,
  prompt: string,
  callbacks: AssistantCallbacks,
): AbortController {
  const controller = new AbortController();
  fetch(`${BASE_URL}/api/secrets/assistant?email=${encodeURIComponent(email)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeader(),
    },
    body: JSON.stringify({ prompt }),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Request failed" }));
        callbacks.onError((err as { error?: string; detail?: string }).error
          ?? (err as { detail?: string }).detail
          ?? "Request failed");
        return;
      }
      const reader = response.body?.getReader();
      if (!reader) {
        callbacks.onError("No response stream");
        return;
      }
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        let currentEvent = "message";
        for (const line of lines) {
          if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            const raw = line.slice(5).trim();
            if (!raw) continue;
            try {
              const data = JSON.parse(raw);
              if (currentEvent === "done") {
                callbacks.onDone();
                return;
              }
              if (currentEvent === "error") {
                callbacks.onError((data as { error?: string }).error ?? "Agent error");
                return;
              }
              callbacks.onMessage(data);
            } catch {
              // skip malformed line
            }
          }
        }
      }
      callbacks.onDone();
    })
    .catch((err) => {
      if (err instanceof DOMException && err.name === "AbortError") return;
      callbacks.onError(String(err));
    });
  return controller;
}
