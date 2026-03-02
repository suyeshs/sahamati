export interface AuthUser {
  email: string;
  name: string;
  picture: string;
  domain: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
  expiresAt: number;
}

const AUTH_SERVICE_URL =
  import.meta.env.VITE_AUTH_SERVICE_URL ?? "http://localhost:3002";

export async function exchangeGoogleCredential(
  credential: string
): Promise<AuthResponse> {
  const res = await fetch(`${AUTH_SERVICE_URL}/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Auth failed" }));
    throw new Error(err.error || `Auth failed: ${res.status}`);
  }

  return res.json();
}

export async function refreshToken(
  token: string
): Promise<{ token: string; expiresAt: number }> {
  const res = await fetch(`${AUTH_SERVICE_URL}/auth/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) throw new Error("Token refresh failed");
  return res.json();
}

export async function logoutFromServer(token: string): Promise<void> {
  await fetch(`${AUTH_SERVICE_URL}/auth/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});
}
