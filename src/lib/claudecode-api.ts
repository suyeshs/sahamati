const BASE_URL = import.meta.env.VITE_AGENT_SERVER_URL || "http://localhost:3001";

export interface ClaudeAuthStatus {
  loggedIn: boolean;
  authMethod?: string;
  apiProvider?: string;
  email?: string;
  orgId?: string;
  orgName?: string;
  subscriptionType?: string;
}

export interface ClaudeAuthResponse {
  installed: boolean;
  binary?: string;
  status?: ClaudeAuthStatus;
  error?: string;
}

export type RunnerMode = "cli" | "sdk";

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = JSON.stringify(await res.json());
    } catch {
      detail = await res.text();
    }
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }
  return (await res.json()) as T;
}

export function getClaudeAuthStatus(): Promise<ClaudeAuthResponse> {
  return jsonFetch<ClaudeAuthResponse>("/api/claudecode/auth/status");
}

export function startClaudeLogin(opts?: { email?: string; sso?: boolean }): Promise<{
  started: boolean;
  error?: string;
}> {
  return jsonFetch("/api/claudecode/auth/login", {
    method: "POST",
    body: JSON.stringify(opts ?? {}),
  });
}

export function logoutClaude(): Promise<{ ok: boolean; error?: string }> {
  return jsonFetch("/api/claudecode/auth/logout", { method: "POST" });
}

export function getRunnerMode(): Promise<{ mode: RunnerMode }> {
  return jsonFetch("/api/claudecode/runner-mode");
}
