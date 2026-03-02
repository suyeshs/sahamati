import { Hono } from "hono";
import { AUTH_CONFIG } from "../auth/config.js";
import { getGitHubToken } from "../auth/github-store.js";

const githubApi = new Hono();

/**
 * GET /api/github/repos
 * List user's repos (public + private). Requires ?email= query param.
 * Supports ?sort=updated&per_page=30&page=1&type=all
 */
githubApi.get("/api/github/repos", async (c) => {
  const email = c.req.query("email");
  if (!email) {
    return c.json({ error: "email query parameter is required" }, 400);
  }

  const connection = getGitHubToken(email);
  if (!connection) {
    return c.json({ error: "GitHub not connected. Please connect your GitHub account first." }, 401);
  }

  const sort = c.req.query("sort") ?? "updated";
  const perPage = c.req.query("per_page") ?? "30";
  const page = c.req.query("page") ?? "1";
  const type = c.req.query("type") ?? "all";
  const q = c.req.query("q");

  try {
    let url: string;
    let headers: Record<string, string> = {
      Authorization: `Bearer ${connection.accessToken}`,
      Accept: "application/vnd.github+json",
    };

    if (q) {
      // Use search API for filtering
      const searchQuery = `${q} user:${connection.username} fork:true`;
      url = `${AUTH_CONFIG.githubApiBase}/search/repositories?q=${encodeURIComponent(searchQuery)}&sort=${sort}&per_page=${perPage}&page=${page}`;
    } else {
      // List user's repos
      url = `${AUTH_CONFIG.githubApiBase}/user/repos?sort=${sort}&per_page=${perPage}&page=${page}&type=${type}&direction=desc`;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      const err = await response.text();
      return c.json({ error: `GitHub API error: ${response.status}`, details: err }, response.status as any);
    }

    const data = await response.json();

    // Search API wraps results in { items: [...] }
    const repos = q ? (data as { items: unknown[] }).items : data;

    return c.json({ repos });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "Failed to fetch repos" },
      500
    );
  }
});

/**
 * GET /api/github/repos/:owner/:repo
 * Get details for a specific repo.
 */
githubApi.get("/api/github/repos/:owner/:repo", async (c) => {
  const email = c.req.query("email");
  if (!email) {
    return c.json({ error: "email query parameter is required" }, 400);
  }

  const connection = getGitHubToken(email);
  if (!connection) {
    return c.json({ error: "GitHub not connected" }, 401);
  }

  const { owner, repo } = c.req.param();

  try {
    const response = await fetch(
      `${AUTH_CONFIG.githubApiBase}/repos/${owner}/${repo}`,
      {
        headers: {
          Authorization: `Bearer ${connection.accessToken}`,
          Accept: "application/vnd.github+json",
        },
      }
    );

    if (!response.ok) {
      return c.json({ error: `Repo not found: ${response.status}` }, response.status as any);
    }

    const data = await response.json();
    return c.json(data);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "Failed to fetch repo" },
      500
    );
  }
});

export default githubApi;
