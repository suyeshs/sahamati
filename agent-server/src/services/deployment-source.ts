import { spawn } from "child_process";
import { mkdtempSync, rmSync, existsSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { DeploymentCreateRequest } from "../types.js";

/**
 * Materialise a deployment source into a fresh temp directory.
 * Caller is responsible for `cleanup()` once the deployment is done.
 *
 * MVP: git-only. Tarball support is reserved in the type union but rejected
 * here until we add a tar dependency (see plan, deferred items).
 *
 * Safety:
 *   - Git clone runs as an argv (no shell) — never interpolate tenant data
 *     into a shell string (CLAUDE.md Hard Rule 1).
 *   - Only https:// and ssh-style git@host:path URLs are accepted; file://,
 *     ext::, and other transports are rejected to prevent local FS access.
 */

export interface ResolvedSource {
  workDir: string;
  sourceRef: string;       // recorded in deployments.source_ref
  cleanup: () => void;
}

const GIT_URL_RE = /^(?:https:\/\/|git@[A-Za-z0-9._-]+:)[A-Za-z0-9._\-\/:@%~?#=&+]+$/;

export async function resolveSource(req: DeploymentCreateRequest["source"]): Promise<ResolvedSource> {
  if (req.type === "tarball") {
    throw new Error("tarball source is not supported in MVP — push via git");
  }
  return resolveGit(req.repoUrl, req.ref);
}

async function resolveGit(repoUrl: string, ref?: string): Promise<ResolvedSource> {
  if (!GIT_URL_RE.test(repoUrl)) {
    throw new Error("repoUrl must be https:// or git@host:path");
  }
  if (ref !== undefined && !/^[A-Za-z0-9._\-\/]+$/.test(ref)) {
    throw new Error("ref contains disallowed characters");
  }

  const workDir = mkdtempSync(join(tmpdir(), "sahamati-deploy-"));
  const args = [
    "clone",
    "--depth", "1",
    "--single-branch",
  ];
  if (ref) args.push("--branch", ref);
  args.push("--", repoUrl, workDir);

  await runArgv("git", args, { GIT_TERMINAL_PROMPT: "0" });

  let commit = "HEAD";
  try {
    commit = (await captureArgv("git", ["-C", workDir, "rev-parse", "HEAD"])).trim();
  } catch {
    // Tolerate — sourceRef just records the URL without a SHA.
  }

  return {
    workDir,
    sourceRef: ref ? `${repoUrl}#${ref}@${commit}` : `${repoUrl}@${commit}`,
    cleanup: () => rmSync(workDir, { recursive: true, force: true }),
  };
}

function runArgv(cmd: string, args: string[], env: Record<string, string> = {}): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    let stderr = "";
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("error", rejectP);
    child.on("close", (code) => {
      if (code === 0) resolveP();
      else rejectP(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

function captureArgv(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("error", rejectP);
    child.on("close", (code) => {
      if (code === 0) resolveP(stdout);
      else rejectP(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

export function readManifestPath(workDir: string): string | null {
  const candidate = join(workDir, "sahamati.deploy.json");
  if (!existsSync(candidate)) return null;
  const st = statSync(candidate);
  if (!st.isFile()) return null;
  return candidate;
}
