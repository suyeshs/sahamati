// Shared types for the defender pipeline. Kept dependency-free so parsers,
// the OSV client, and the typed MCP tools can all import from here without
// pulling in the DB or the SDK.

export type Ecosystem = "npm" | "crates.io" | "PyPI" | "terraform";

export type LockfileFormat =
  | "bun-lock"
  | "npm-lock-v3"
  | "cargo-lock"
  | "uv-lock"
  | "terraform-lock";

export interface LockfileRef {
  /** Path relative to the repo root, POSIX separators. */
  path: string;
  ecosystem: Ecosystem;
  format: LockfileFormat;
  /** Manifest the lockfile belongs to (package.json, Cargo.toml, pyproject.toml). Relative. */
  manifestPath: string;
}

export interface LockedPackage {
  name: string;
  version: string;
  /** Declared in the manifest (vs pulled in transitively). */
  direct: boolean;
}

export interface ParsedLockfile extends LockfileRef {
  packages: LockedPackage[];
}

/** One vulnerability as the pipeline understands it, after OSV + audits are merged. */
export interface DependencyVulnerability {
  ecosystem: Ecosystem;
  package: string;
  installedVersion: string;
  fixedVersion: string | null;
  advisoryIds: string[];
  primaryId: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  summary: string;
  details: string;
  manifestPath: string;
  lockfilePath: string;
  direct: boolean;
  references: string[];
  /** Where the fixed version came from; audits never override OSV here. */
  source: "osv" | "audit";
}
