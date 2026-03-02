const AGENT_SERVER_URL =
  import.meta.env.VITE_AGENT_SERVER_URL ?? "http://localhost:3001";

export interface GitHubRepo {
  id: number;
  full_name: string;
  name: string;
  private: boolean;
  description: string | null;
  html_url: string;
  clone_url: string;
  language: string | null;
  updated_at: string;
  stargazers_count: number;
}

export async function startGitHubOAuth(
  email: string
): Promise<{ authUrl: string; sessionId: string }> {
  const res = await fetch(
    `${AGENT_SERVER_URL}/auth/github/start?email=${encodeURIComponent(email)}`
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to start GitHub OAuth" }));
    throw new Error((err as { error: string }).error);
  }
  return res.json();
}

export async function pollGitHubAuth(
  sessionId: string
): Promise<{ status: string; data?: { username: string; connected: boolean }; error?: string }> {
  const res = await fetch(
    `${AGENT_SERVER_URL}/auth/github/poll/${sessionId}`
  );
  return res.json();
}

export async function getGitHubStatus(
  email: string
): Promise<{ connected: boolean; username?: string }> {
  const res = await fetch(
    `${AGENT_SERVER_URL}/auth/github/status?email=${encodeURIComponent(email)}`
  );
  if (!res.ok) return { connected: false };
  return res.json();
}

export async function disconnectGitHub(email: string): Promise<void> {
  await fetch(`${AGENT_SERVER_URL}/auth/github/disconnect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

export async function listGitHubRepos(
  email: string,
  options?: { page?: number; perPage?: number; sort?: string; q?: string }
): Promise<GitHubRepo[]> {
  const params = new URLSearchParams({
    email,
    sort: options?.sort ?? "updated",
    per_page: String(options?.perPage ?? 30),
    page: String(options?.page ?? 1),
  });
  if (options?.q) {
    params.set("q", options.q);
  }

  const res = await fetch(`${AGENT_SERVER_URL}/api/github/repos?${params.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to fetch repos" }));
    throw new Error((err as { error: string }).error);
  }
  const data = (await res.json()) as { repos: GitHubRepo[] };
  return data.repos;
}
