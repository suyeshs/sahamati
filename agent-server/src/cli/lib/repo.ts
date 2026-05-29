import { execFileSync } from "node:child_process";
import { basename, resolve } from "node:path";
import { existsSync, statSync } from "node:fs";

export class NotAGitRepoError extends Error {
  constructor(public readonly cwd: string) {
    super(
      `Not inside a git repository (cwd: ${cwd}).\n` +
        `Run \`git init\` first, or cd into an existing repo.`
    );
    this.name = "NotAGitRepoError";
  }
}

export function findRepoRoot(start: string = process.cwd()): string {
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: start,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!root) throw new NotAGitRepoError(start);
    return resolve(root);
  } catch {
    throw new NotAGitRepoError(start);
  }
}

export function repoSlug(repoRoot: string): string {
  return slugify(basename(repoRoot));
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function gitAddCommit(
  repoRoot: string,
  paths: string[],
  message: string
): { committed: boolean; sha?: string } {
  execFileSync("git", ["add", "--", ...paths], { cwd: repoRoot, stdio: "inherit" });
  try {
    execFileSync("git", ["commit", "-m", message], {
      cwd: repoRoot,
      stdio: "inherit",
    });
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf-8",
    }).trim();
    return { committed: true, sha };
  } catch {
    return { committed: false };
  }
}

export function pathExists(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
}
