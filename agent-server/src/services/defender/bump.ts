// Deterministic dependency bumps. Every function here takes a validated
// BumpSpec produced by the typed tool layer and runs a fixed, ecosystem-specific
// command through execFile (no shell). The model never composes a command.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Ecosystem } from "./types.js";
import { resolveInside } from "./workspace.js";
import { toolAvailable } from "./audit-runner.js";

const execFileAsync = promisify(execFile);

export type BumpStrategy = "direct" | "override" | "cargo-precise" | "uv-constraint";

export interface BumpSpec {
  ecosystem: Ecosystem;
  package: string;
  manifestPath: string;
  lockfilePath: string;
  fromVersion: string;
  toVersion: string;
  strategy: BumpStrategy;
}

export interface CommandResult {
  ok: boolean;
  command: string;
  exitCode: number | null;
  /** Combined stdout+stderr, tail-truncated. Safe to show to the model. */
  output: string;
  durationMs: number;
}

const MAX_OUTPUT = 12_000;

function tail(s: string): string {
  return s.length > MAX_OUTPUT ? `…(truncated)…\n${s.slice(-MAX_OUTPUT)}` : s;
}

async function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<CommandResult> {
  const started = Date.now();
  const command = [cmd, ...args].join(" ");
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    CI: "1",
    NO_COLOR: "1",
    npm_config_ignore_scripts: "true",
    BUN_INSTALL_IGNORE_SCRIPTS: "1",
    CARGO_NET_RETRY: "2",
    UV_NO_PROGRESS: "1",
  };
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { cwd, env, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
    return { ok: true, command, exitCode: 0, output: tail(`${stdout}\n${stderr}`.trim()), durationMs: Date.now() - started };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number | string; killed?: boolean; message?: string };
    const output = e.killed ? `timed out after ${timeoutMs}ms` : `${e.stdout ?? ""}\n${e.stderr ?? e.message ?? ""}`.trim();
    return { ok: false, command, exitCode: typeof e.code === "number" ? e.code : null, output: tail(output), durationMs: Date.now() - started };
  }
}

export class ToolchainMissingError extends Error {
  constructor(public readonly tool: string) {
    super(`toolchain-missing: ${tool} is not on PATH of the agent-server host`);
  }
}

async function requireTool(cmd: string): Promise<void> {
  if (!(await toolAvailable(cmd))) throw new ToolchainMissingError(cmd);
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Files a bump may touch; restored on failure by the caller. */
export function bumpChangedFiles(spec: BumpSpec): string[] {
  return Array.from(new Set([spec.manifestPath, spec.lockfilePath]));
}

/**
 * Edit the manifest and regenerate the lockfile for one bump. Returns the
 * command log. Throws ToolchainMissingError when the package manager is absent.
 */
export async function applyBump(repoDir: string, spec: BumpSpec, timeoutMs = 300_000): Promise<CommandResult> {
  const manifestAbs = resolveInside(repoDir, spec.manifestPath);
  resolveInside(repoDir, spec.lockfilePath);
  const cwd = dirname(manifestAbs);

  switch (spec.ecosystem) {
    case "npm": {
      const isBun = spec.lockfilePath.endsWith("bun.lock");
      const pm = isBun ? "bun" : "npm";
      await requireTool(pm);
      const pkg = readJson(manifestAbs);
      if (spec.strategy === "override") {
        const overrides = (pkg.overrides as Record<string, unknown> | undefined) ?? {};
        overrides[spec.package] = spec.toVersion;
        pkg.overrides = overrides;
        writeJson(manifestAbs, pkg);
      } else {
        let found = false;
        for (const group of ["dependencies", "devDependencies", "optionalDependencies"]) {
          const deps = pkg[group] as Record<string, string> | undefined;
          if (deps && spec.package in deps) {
            deps[spec.package] = `^${spec.toVersion}`;
            found = true;
          }
        }
        if (!found) throw new Error(`${spec.package} is not a direct dependency in ${spec.manifestPath}; use strategy "override"`);
        writeJson(manifestAbs, pkg);
      }
      return isBun
        ? run("bun", ["install", "--lockfile-only", "--ignore-scripts"], cwd, timeoutMs)
        : run("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], cwd, timeoutMs);
    }
    case "crates.io": {
      await requireTool("cargo");
      if (spec.strategy === "direct") {
        // Bump a simple `name = "x.y.z"` or `name = { version = "x.y.z", ... }` requirement.
        const text = readFileSync(manifestAbs, "utf-8");
        const esc = spec.package.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const simple = new RegExp(`^(\\s*${esc}\\s*=\\s*)"[^"]*"`, "m");
        const table = new RegExp(`^(\\s*${esc}\\s*=\\s*\\{[^}]*version\\s*=\\s*)"[^"]*"`, "m");
        const next = simple.test(text) ? text.replace(simple, `$1"${spec.toVersion}"`) : text.replace(table, `$1"${spec.toVersion}"`);
        if (next === text) throw new Error(`could not find a version requirement for ${spec.package} in ${spec.manifestPath}; use strategy "cargo-precise"`);
        writeFileSync(manifestAbs, next);
      }
      return run("cargo", ["update", "--manifest-path", manifestAbs, "-p", spec.package, "--precise", spec.toVersion], cwd, timeoutMs);
    }
    case "PyPI": {
      await requireTool("uv");
      if (spec.strategy === "uv-constraint") {
        const text = readFileSync(manifestAbs, "utf-8");
        const line = `"${spec.package}>=${spec.toVersion}"`;
        const next = /^\[tool\.uv\]/m.test(text)
          ? text.replace(/^\[tool\.uv\]\s*$/m, `[tool.uv]\nconstraint-dependencies = [${line}]`)
          : `${text.trimEnd()}\n\n[tool.uv]\nconstraint-dependencies = [${line}]\n`;
        writeFileSync(manifestAbs, next);
        return run("uv", ["lock"], cwd, timeoutMs);
      }
      return run("uv", ["lock", "--upgrade-package", `${spec.package}==${spec.toVersion}`], cwd, timeoutMs);
    }
    case "terraform":
      return { ok: false, command: "n/a", exitCode: null, output: "unsupported: terraform providers are inventory-only in this iteration", durationMs: 0 };
  }
}

/** Install from the regenerated lockfile so tests run against the new tree. Scripts stay disabled. */
export async function runInstall(repoDir: string, spec: BumpSpec, timeoutMs = 600_000): Promise<CommandResult> {
  const cwd = dirname(resolveInside(repoDir, spec.manifestPath));
  switch (spec.ecosystem) {
    case "npm":
      if (spec.lockfilePath.endsWith("bun.lock")) {
        await requireTool("bun");
        return run("bun", ["install", "--frozen-lockfile", "--ignore-scripts"], cwd, timeoutMs);
      }
      await requireTool("npm");
      return run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], cwd, timeoutMs);
    case "crates.io":
      await requireTool("cargo");
      return run("cargo", ["fetch", "--manifest-path", join(cwd, "Cargo.toml")], cwd, timeoutMs);
    case "PyPI":
      await requireTool("uv");
      return run("uv", ["sync", "--frozen"], cwd, timeoutMs);
    case "terraform":
      return { ok: false, command: "n/a", exitCode: null, output: "unsupported ecosystem", durationMs: 0 };
  }
}

export type TestSuite = "default" | "typecheck";

/** Run the project's own test or build command. "no-tests" is reported, not treated as failure. */
export async function runTests(repoDir: string, spec: BumpSpec, suite: TestSuite, timeoutMs: number): Promise<CommandResult & { skipped?: string }> {
  const manifestAbs = resolveInside(repoDir, spec.manifestPath);
  const cwd = dirname(manifestAbs);
  switch (spec.ecosystem) {
    case "npm": {
      const pkg = readJson(manifestAbs);
      const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {};
      const script = suite === "typecheck" ? (scripts.build ? "build" : scripts.typecheck ? "typecheck" : null) : scripts.test ? "test" : null;
      if (!script) return { ok: true, command: "n/a", exitCode: null, output: "", durationMs: 0, skipped: `no "${suite === "typecheck" ? "build" : "test"}" script in ${spec.manifestPath}` };
      if (spec.lockfilePath.endsWith("bun.lock")) {
        await requireTool("bun");
        return run("bun", ["run", script], cwd, timeoutMs);
      }
      await requireTool("npm");
      return run("npm", ["run", script, "--silent"], cwd, timeoutMs);
    }
    case "crates.io":
      await requireTool("cargo");
      return suite === "typecheck"
        ? run("cargo", ["check", "--manifest-path", manifestAbs], cwd, timeoutMs)
        : run("cargo", ["test", "--manifest-path", manifestAbs, "--no-fail-fast"], cwd, timeoutMs);
    case "PyPI": {
      await requireTool("uv");
      if (suite === "typecheck") {
        return run("uv", ["run", "--frozen", "python", "-c", "import compileall,sys; sys.exit(0 if compileall.compile_dir('.', quiet=1) else 1)"], cwd, timeoutMs);
      }
      const r = await run("uv", ["run", "--frozen", "pytest", "-q", "-x"], cwd, timeoutMs);
      // pytest exit code 5 means no tests were collected.
      if (!r.ok && r.exitCode === 5) return { ...r, ok: true, skipped: "pytest collected no tests" };
      if (!r.ok && /No module named pytest|not found/i.test(r.output)) return { ...r, ok: true, skipped: "pytest is not installed in this project" };
      return r;
    }
    case "terraform":
      return { ok: false, command: "n/a", exitCode: null, output: "unsupported ecosystem", durationMs: 0 };
  }
}

export function manifestExists(repoDir: string, manifestPath: string): boolean {
  try {
    return existsSync(resolveInside(repoDir, manifestPath));
  } catch {
    return false;
  }
}
