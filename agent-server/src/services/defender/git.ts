// Git and GitHub helpers for defender runs. The token travels as an explicit
// argument and reaches git only through a per-invocation `-c http.extraheader`,
// so it is never written to .git/config, never placed in the clone URL, and
// never set on process.env.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface RepoRef {
  owner: string;
  name: string;
}

/** Accepts https://github.com/owner/repo(.git), git@github.com:owner/repo, or owner/repo. */
export function parseGitHubRepo(input: string): RepoRef {
  let s = input.trim();
  s = s.replace(/^https?:\/\/(www\.)?github\.com\//, "");
  s = s.replace(/^git@github\.com:/, "");
  const parts = s.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error(`Could not parse owner/repo from: ${input}`);
  const owner = parts[0];
  const name = parts[1].replace(/\.git$/, "");
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(name)) {
    throw new Error(`Unexpected characters in owner/repo: ${input}`);
  }
  return { owner, name };
}

export function isFileTarget(url: string): boolean {
  return url.startsWith("file://");
}

export function fileTargetPath(url: string): string {
  return decodeURIComponent(url.replace(/^file:\/\//, ""));
}

function authArgs(token?: string): string[] {
  if (!token) return [];
  const header = `AUTHORIZATION: bearer ${token}`;
  return ["-c", `http.https://github.com/.extraheader=${header}`];
}

/** Remove the token from anything that might be surfaced to a log or the model. */
export function scrub(text: string, token?: string): string {
  if (!token) return text;
  return text.split(token).join("[redacted]");
}

async function git(args: string[], opts: { cwd?: string; token?: string; env?: NodeJS.ProcessEnv }): Promise<{ stdout: string; stderr: string }> {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    LC_ALL: "C",
    ...(opts.env ?? {}),
  };
  try {
    return await execFileAsync("git", [...authArgs(opts.token), ...args], { cwd: opts.cwd, env, maxBuffer: 16 * 1024 * 1024 });
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    throw new Error(`git ${args[0]} failed: ${scrub(String(e.stderr || e.message || err), opts.token)}`);
  }
}

export async function cloneInto(dir: string, repo: RepoRef, opts: { ref?: string; token?: string; depth?: number }): Promise<void> {
  const url = `https://github.com/${repo.owner}/${repo.name}.git`;
  const args = ["clone", "--depth", String(opts.depth ?? 50), "--no-tags"];
  if (opts.ref) args.push("--branch", opts.ref);
  args.push(url, dir);
  await git(args, { token: opts.token });
}

export async function currentBranch(dir: string): Promise<string> {
  const { stdout } = await git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir });
  return stdout.trim();
}

export async function headSha(dir: string): Promise<string> {
  const { stdout } = await git(["rev-parse", "HEAD"], { cwd: dir });
  return stdout.trim();
}

export async function checkoutNewBranch(dir: string, branch: string): Promise<void> {
  if (!/^defender\/[A-Za-z0-9._\-]+$/.test(branch)) {
    throw new Error(`defender branches must match defender/<slug>; got ${branch}`);
  }
  await git(["checkout", "-b", branch], { cwd: dir });
}

export async function restoreFiles(dir: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await git(["checkout", "--", ...paths], { cwd: dir });
}

export async function commitFiles(dir: string, paths: string[], message: string): Promise<string> {
  const author = process.env.SAHAMATI_DEFENDER_GIT_AUTHOR ?? "Sahamati Defender <defender-bot@users.noreply.github.com>";
  const m = author.match(/^(.*?)\s*<([^>]+)>$/);
  const env = m
    ? { GIT_AUTHOR_NAME: m[1], GIT_AUTHOR_EMAIL: m[2], GIT_COMMITTER_NAME: m[1], GIT_COMMITTER_EMAIL: m[2] }
    : {};
  await git(["add", "--", ...paths], { cwd: dir });
  await git(["commit", "-m", message], { cwd: dir, env });
  return headSha(dir);
}

export async function pushBranch(dir: string, branch: string, token: string): Promise<void> {
  if (!branch.startsWith("defender/")) throw new Error("refusing to push a non-defender branch");
  await git(["push", "-u", "origin", `${branch}:${branch}`], { cwd: dir, token });
}

export async function defaultBranch(dir: string): Promise<string> {
  try {
    const { stdout } = await git(["symbolic-ref", "refs/remotes/origin/HEAD"], { cwd: dir });
    return stdout.trim().replace(/^refs\/remotes\/origin\//, "");
  } catch {
    return currentBranch(dir);
  }
}

/** Open a PR via the GitHub REST API. Returns the HTML URL. */
export async function openPullRequest(params: {
  repo: RepoRef;
  token: string;
  head: string;
  base: string;
  title: string;
  body: string;
}): Promise<{ url: string; number: number }> {
  const res = await fetch(`https://api.github.com/repos/${params.repo.owner}/${params.repo.name}/pulls`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${params.token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({ title: params.title, body: params.body, head: params.head, base: params.base, draft: false }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub PR create failed (${res.status}): ${scrub(text.slice(0, 500), params.token)}`);
  }
  const json = (await res.json()) as { html_url: string; number: number };
  return { url: json.html_url, number: json.number };
}
