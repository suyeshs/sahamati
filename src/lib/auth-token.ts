// In-memory session token.
//
// The token (a Google ID token) is held only in this module variable and in
// AuthContext's React state — never in localStorage or any on-disk store. It is
// set on login, cleared on logout, and lost when the WebView reloads, so the
// user re-authenticates on each app start. Plain API-client modules can't use
// the React context, so they read the token from here to attach
// `Authorization: Bearer <token>`, which the agent-server verifies per request.

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

/** Set (or clear, with null) the active session token. Called by AuthContext. */
export function setAuthToken(next: string | null): void {
  token = next;
}

/**
 * Register the teardown handler invoked when a protected route reports the
 * session is no longer valid (HTTP 401). AuthContext registers `clearSession`
 * here; pass null to unregister. Only one handler is held at a time.
 */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

/**
 * Central response check for protected API calls. A 401 means the in-memory
 * token is no longer accepted (expired / unverifiable, or no user row), so the
 * token is dropped synchronously and the teardown handler fires to force a
 * fresh login. 403 is deliberately NOT handled here: it is an authorization
 * (per-resource permission) failure on a still-valid session and must not log
 * the user out — callers surface it as a normal request error.
 *
 * Returns the same response so callers can chain: `fetch(...).then(handleAuthFailure)`.
 */
export function handleAuthFailure(res: Response): Response {
  if (res.status === 401) {
    token = null;
    onUnauthorized?.();
  }
  return res;
}

export function getAuthToken(): string | null {
  return token;
}

/** Authorization header for fetch-based requests; empty if not signed in. */
export function authHeader(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Append the token as a `token` query parameter. For direct
 * <video>/<img>/download URLs, which cannot carry an Authorization header.
 */
export function appendToken(url: string): string {
  if (!token) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}
