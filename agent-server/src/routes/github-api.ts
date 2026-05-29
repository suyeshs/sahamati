import { Hono } from "hono";
import { AUTH_CONFIG } from "../auth/config.js";
import { getGitHubToken } from "../auth/github-store.js";

const githubApi = new Hono();

/**
 * GET /repos
 * List user's repos (public + private). Requires ?email= query param.
 * Supports ?sort=updated&per_page=30&page=1&type=all
 */
githubApi.get("/repos", async (c) => {
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
  const q = c.req.query("q");

  try {
    let url: string;
    let headers: Record<string, string> = {
      Authorization: `Bearer ${connection.accessToken}`,
      Accept: "application/vnd.github+json",
    };

    if (q) {
      // Use search API — no user: filter so it finds org repos too
      const searchQuery = `${q} fork:true`;
      url = `${AUTH_CONFIG.githubApiBase}/search/repositories?q=${encodeURIComponent(searchQuery)}&sort=${sort}&per_page=${perPage}&page=${page}`;

      const response = await fetch(url, { headers });
      if (!response.ok) {
        const err = await response.text();
        return c.json({ error: `GitHub API error: ${response.status}`, details: err }, response.status as any);
      }
      const data = (await response.json()) as { items: unknown[] };
      return c.json({ repos: data.items });
    }

    // Fetch user repos (owner + collaborator + org member) in parallel with org repos
    // visibility=all ensures private shared repos are included
    const userUrl = `${AUTH_CONFIG.githubApiBase}/user/repos?sort=${sort}&per_page=${perPage}&page=${page}&affiliation=owner,collaborator,organization_member&visibility=all&direction=desc`;

    // Also fetch orgs the user belongs to, then their repos
    const [userResponse, orgsResponse] = await Promise.all([
      fetch(userUrl, { headers }),
      fetch(`${AUTH_CONFIG.githubApiBase}/user/orgs?per_page=100`, { headers }),
    ]);

    if (!userResponse.ok) {
      const err = await userResponse.text();
      return c.json({ error: `GitHub API error: ${userResponse.status}`, details: err }, userResponse.status as any);
    }
    const userRepos = (await userResponse.json()) as Array<{ id: number; full_name: string; [k: string]: unknown }>;

    // Fetch repos from each org the user belongs to
    let orgRepos: Array<{ id: number; full_name: string; [k: string]: unknown }> = [];
    if (orgsResponse.ok) {
      const orgs = (await orgsResponse.json()) as Array<{ login: string }>;
      const orgRepoResults = await Promise.all(
        orgs.map((org) =>
          fetch(
            `${AUTH_CONFIG.githubApiBase}/orgs/${org.login}/repos?sort=${sort}&per_page=${perPage}&page=${page}&type=all`,
            { headers }
          ).then((r) => (r.ok ? r.json() : []))
        )
      );
      orgRepos = orgRepoResults.flat() as typeof orgRepos;
    }

    // Deduplicate by repo id
    const seen = new Set<number>();
    const repos = [...userRepos, ...orgRepos].filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });

    return c.json({ repos });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "Failed to fetch repos" },
      500
    );
  }
});

/**
 * GET /repos/:owner/:repo
 * Get details for a specific repo.
 */
githubApi.get("/repos/:owner/:repo", async (c) => {
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

/**
 * GET /repos/:owner/:repo/branches
 * List branches for a repo.
 * IMPORTANT: Must be registered BEFORE the contents/* wildcard route.
 */
githubApi.get("/repos/:owner/:repo/branches", async (c) => {
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
      `${AUTH_CONFIG.githubApiBase}/repos/${owner}/${repo}/branches?per_page=100`,
      {
        headers: {
          Authorization: `Bearer ${connection.accessToken}`,
          Accept: "application/vnd.github+json",
        },
      }
    );

    if (!response.ok) {
      return c.json(
        { error: `GitHub API error: ${response.status}` },
        response.status as any
      );
    }

    const data = await response.json();
    return c.json({ branches: data });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "Failed to fetch branches" },
      500
    );
  }
});

/**
 * GET /repos/:owner/:repo/contents/*path
 * Browse repository contents (files and folders).
 * Supports ?ref=branch query param (defaults to default branch).
 * NOTE: This wildcard route must come AFTER specific sub-routes like /branches.
 */
githubApi.get("/repos/:owner/:repo/contents/*", async (c) => {
  const email = c.req.query("email");
  if (!email) {
    return c.json({ error: "email query parameter is required" }, 400);
  }

  const connection = getGitHubToken(email);
  if (!connection) {
    return c.json({ error: "GitHub not connected" }, 401);
  }

  const { owner, repo } = c.req.param();
  // Hono stores the wildcard match in the param object — extract content path
  const allParams = c.req.param() as Record<string, string>;
  const path = (allParams["*"] ?? "").replace(/^\/+/, "");
  const ref = c.req.query("ref") ?? "";

  try {
    let url = `${AUTH_CONFIG.githubApiBase}/repos/${owner}/${repo}/contents/${path}`;
    if (ref) url += `?ref=${encodeURIComponent(ref)}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${connection.accessToken}`,
        Accept: "application/vnd.github+json",
      },
    });

    if (!response.ok) {
      return c.json(
        { error: `GitHub API error: ${response.status}` },
        response.status as any
      );
    }

    const data = await response.json();
    return c.json({ contents: data });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "Failed to fetch contents" },
      500
    );
  }
});

export default githubApi;
