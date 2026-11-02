// Lockfile discovery and dispatch. Parsers are pure functions over file
// contents so they can be unit-tested with synthetic fixtures; discovery walks
// the checkout but skips vendored and build directories.

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative, dirname, posix } from "node:path";
import type { LockfileRef, ParsedLockfile, LockfileFormat } from "../types.js";
import { parseBunLock } from "./bun-lock.js";
import { parseNpmLock } from "./npm-lock.js";
import { parseCargoLock } from "./cargo-lock.js";
import { parseUvLock } from "./uv-lock.js";
import { parseTerraformLock } from "./terraform-lock.js";

export { parseBunLock, parseNpmLock, parseCargoLock, parseUvLock, parseTerraformLock };

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "target",
  ".venv",
  "venv",
  ".terraform",
  "__pycache__",
  ".next",
  "coverage",
]);

const LOCKFILE_BY_NAME: Record<string, { format: LockfileFormat; ecosystem: LockfileRef["ecosystem"]; manifest: string }> = {
  "bun.lock": { format: "bun-lock", ecosystem: "npm", manifest: "package.json" },
  "package-lock.json": { format: "npm-lock-v3", ecosystem: "npm", manifest: "package.json" },
  "Cargo.lock": { format: "cargo-lock", ecosystem: "crates.io", manifest: "Cargo.toml" },
  "uv.lock": { format: "uv-lock", ecosystem: "PyPI", manifest: "pyproject.toml" },
  ".terraform.lock.hcl": { format: "terraform-lock", ecosystem: "terraform", manifest: "." },
};

const MAX_DEPTH = 8;

function toPosix(p: string): string {
  return p.split("\\").join("/");
}

/** Enumerate every supported lockfile under `repoDir`. Paths are repo-relative. */
export function discoverLockfiles(repoDir: string): LockfileRef[] {
  const out: LockfileRef[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > MAX_DEPTH) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(full, depth + 1);
        continue;
      }
      const spec = LOCKFILE_BY_NAME[name];
      if (!spec) continue;
      const rel = toPosix(relative(repoDir, full));
      const manifestRel =
        spec.manifest === "." ? toPosix(relative(repoDir, dir)) || "." : posix.join(posix.dirname(rel), spec.manifest);
      out.push({ path: rel, ecosystem: spec.ecosystem, format: spec.format, manifestPath: manifestRel });
    }
  };
  walk(repoDir, 0);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

/** Parse one discovered lockfile. Reads the sibling manifest when it exists to mark direct deps. */
export function parseLockfile(repoDir: string, ref: LockfileRef): ParsedLockfile {
  const lockText = readFileSync(join(repoDir, ref.path), "utf-8");
  const manifestAbs = join(repoDir, ref.manifestPath);
  const manifestText =
    ref.format !== "terraform-lock" && existsSync(manifestAbs) && statSync(manifestAbs).isFile()
      ? readFileSync(manifestAbs, "utf-8")
      : null;

  let packages;
  switch (ref.format) {
    case "bun-lock":
      packages = parseBunLock(lockText);
      break;
    case "npm-lock-v3":
      packages = parseNpmLock(lockText);
      break;
    case "cargo-lock":
      packages = parseCargoLock(lockText, manifestText);
      break;
    case "uv-lock":
      packages = parseUvLock(lockText, manifestText);
      break;
    case "terraform-lock":
      packages = parseTerraformLock(lockText);
      break;
  }
  return { ...ref, packages };
}

/** Resolve the directory a lockfile's package manager should run in. */
export function lockfileDir(ref: LockfileRef): string {
  return dirname(ref.path) === "." ? "." : toPosix(dirname(ref.path));
}
