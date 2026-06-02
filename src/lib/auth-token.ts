// In-memory session token.
//
// The token (a Google ID token) is held only in this module variable and in
// AuthContext's React state — never in localStorage or any on-disk store. It is
// set on login, cleared on logout, and lost when the WebView reloads, so the
// user re-authenticates on each app start. Plain API-client modules can't use
// the React context, so they read the token from here to attach
// `Authorization: Bearer <token>`, which the agent-server verifies per request.

let token: string | null = null;

/** Set (or clear, with null) the active session token. Called by AuthContext. */
export function setAuthToken(next: string | null): void {
  token = next;
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
