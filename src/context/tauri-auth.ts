import type { AuthResponse } from "./auth-api";

const AGENT_SERVER_URL =
  import.meta.env.VITE_AGENT_SERVER_URL ?? "http://localhost:3001";

/**
 * Detect if running inside Tauri's WKWebView vs a regular browser.
 */
export function isTauriEnvironment(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Start OAuth flow: get auth URL and session ID from agent-server.
 */
export async function startOAuthFlow(): Promise<{
  authUrl: string;
  sessionId: string;
}> {
  const res = await fetch(`${AGENT_SERVER_URL}/auth/start`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to start authentication" }));
    throw new Error(err.error || "Failed to start authentication");
  }
  return res.json();
}

/**
 * Open URL in the system default browser using tauri-plugin-shell.
 */
export async function openInSystemBrowser(url: string): Promise<void> {
  const { open } = await import("@tauri-apps/plugin-shell");
  await open(url);
}

/**
 * Poll the agent-server for auth completion.
 */
export async function pollAuthResult(
  sessionId: string,
  options: {
    intervalMs?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {}
): Promise<AuthResponse> {
  const { intervalMs = 2000, timeoutMs = 300_000, signal } = options;
  const startTime = Date.now();

  while (true) {
    if (signal?.aborted) {
      throw new DOMException("Authentication was cancelled", "AbortError");
    }

    if (Date.now() - startTime > timeoutMs) {
      throw new Error("Authentication timed out. Please try again.");
    }

    const res = await fetch(`${AGENT_SERVER_URL}/auth/poll/${sessionId}`, {
      signal,
    });

    if (!res.ok && res.status !== 404) {
      throw new Error("Failed to check authentication status");
    }

    const data = await res.json();

    if (data.status === "complete") {
      return data.data as AuthResponse;
    }

    if (data.status === "error") {
      throw new Error(data.error || "Authentication failed");
    }

    // status === "pending" — wait and retry
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
