import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBunLock } from "./bun-lock.js";
import { parseNpmLock } from "./npm-lock.js";
import { parseCargoLock, cargoDirectDependencies } from "./cargo-lock.js";
import { parseUvLock, pyprojectDirectDependencies } from "./uv-lock.js";
import { parseTerraformLock } from "./terraform-lock.js";
import { discoverLockfiles, parseLockfile } from "./index.js";

// All fixtures use synthetic package names (pkg-test-NNN) per org rule §1.

const BUN_LOCK = `{
  // bun lockfile
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "fixture",
      "dependencies": { "pkg-test-001": "^1.0.0", "@scope/pkg-test-002": "~2.1.0", },
      "devDependencies": { "pkg-test-dev": "^0.1.0", },
    },
  },
  "packages": {
    "pkg-test-001": ["pkg-test-001@1.2.3", "", { "dependencies": { "pkg-test-003": "^4.0.0" } }, "sha512-aaa"],
    "@scope/pkg-test-002": ["@scope/pkg-test-002@2.1.5", "", {}, "sha512-bbb"],
    "pkg-test-003": ["pkg-test-003@4.0.1", "", {}, "sha512-ccc"],
    "pkg-test-001/pkg-test-003": ["pkg-test-003@3.9.9", "", {}, "sha512-ddd"],
    "pkg-test-dev": ["pkg-test-dev@0.1.0", "", {}, "sha512-eee"],
    "local-ws": ["local-ws@workspace:packages/local", {}],
  },
}`;

describe("bun.lock parser", () => {
  it("handles JSONC, scoped names, nested resolutions and direct marking", () => {
    const pkgs = parseBunLock(BUN_LOCK);
    const byKey = Object.fromEntries(pkgs.map((p) => [`${p.name}@${p.version}`, p]));
    expect(byKey["pkg-test-001@1.2.3"].direct).toBe(true);
    expect(byKey["@scope/pkg-test-002@2.1.5"].direct).toBe(true);
    expect(byKey["pkg-test-003@4.0.1"].direct).toBe(false);
    expect(byKey["pkg-test-003@3.9.9"].direct).toBe(false);
    expect(byKey["pkg-test-dev@0.1.0"].direct).toBe(true);
    expect(pkgs.find((p) => p.name === "local-ws")).toBeUndefined();
    expect(pkgs).toHaveLength(5);
  });
});

const NPM_LOCK = JSON.stringify({
  name: "fixture",
  lockfileVersion: 3,
  packages: {
    "": { dependencies: { "pkg-test-001": "^1.0.0" }, devDependencies: { "pkg-test-dev": "^0.1.0" } },
    "node_modules/pkg-test-001": { version: "1.2.3", resolved: "https://registry.npmjs.org/x.tgz" },
    "node_modules/pkg-test-001/node_modules/pkg-test-003": { version: "3.9.9" },
    "node_modules/pkg-test-003": { version: "4.0.1" },
    "node_modules/pkg-test-dev": { version: "0.1.0", dev: true },
    "node_modules/linked": { resolved: "packages/linked", link: true },
    "packages/linked": { name: "linked", version: "0.0.0" },
  },
});

describe("package-lock v3 parser", () => {
  it("extracts names from nested node_modules keys and skips links/workspaces", () => {
    const pkgs = parseNpmLock(NPM_LOCK);
    expect(pkgs.map((p) => `${p.name}@${p.version}:${p.direct ? "d" : "t"}`).sort()).toEqual([
      "pkg-test-001@1.2.3:d",
      "pkg-test-003@3.9.9:t",
      "pkg-test-003@4.0.1:t",
      "pkg-test-dev@0.1.0:d",
    ]);
  });
  it("rejects lockfileVersion 1", () => {
    expect(() => parseNpmLock(JSON.stringify({ lockfileVersion: 1, dependencies: {} }))).toThrow(/only v2\/v3/);
  });
});

const CARGO_LOCK = `# generated
version = 4

[[package]]
name = "crate-test-001"
version = "1.0.4"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "abc"
dependencies = [
 "crate-test-002",
]

[[package]]
name = "crate-test-002"
version = "0.3.1"
source = "registry+https://github.com/rust-lang/crates.io-index"

[[package]]
name = "my-app"
version = "0.1.0"
dependencies = [
 "crate-test-001",
]

[[package]]
name = "crate-test-git"
version = "2.0.0"
source = "git+https://github.com/example/crate-test-git#deadbeef"
`;

const CARGO_TOML = `[package]
name = "my-app"
version = "0.1.0"

[dependencies]
crate-test-001 = "1"
renamed = { package = "crate-test-002", version = "0.3" }

[build-dependencies]
build-test = "1"

[dependencies.inline-table]
version = "0.1"
`;

describe("Cargo.lock parser", () => {
  it("keeps registry crates only and marks direct deps from Cargo.toml", () => {
    const direct = cargoDirectDependencies(CARGO_TOML);
    expect([...direct].sort()).toEqual(["build-test", "crate-test-001", "crate-test-002", "inline-table"]);
    const pkgs = parseCargoLock(CARGO_LOCK, CARGO_TOML);
    expect(pkgs).toEqual([
      { name: "crate-test-001", version: "1.0.4", direct: true },
      { name: "crate-test-002", version: "0.3.1", direct: true },
    ]);
  });
});

const UV_LOCK = `version = 1
revision = 3
requires-python = ">=3.11"

[[package]]
name = "py-test-001"
version = "2.5.0"
source = { registry = "https://pypi.org/simple" }
dependencies = [
    { name = "py-test-002" },
]
sdist = { url = "https://files.example/py_test_001-2.5.0.tar.gz", hash = "sha256:aaa" }

[[package]]
name = "Py_Test.002"
version = "0.9.1"
source = { registry = "https://pypi.org/simple" }

[[package]]
name = "fixture-app"
version = "0.1.0"
source = { editable = "." }
dependencies = [
    { name = "py-test-001" },
]

[package.metadata]
requires-dist = [{ name = "py-test-001", specifier = ">=2" }]
`;

const PYPROJECT = `[project]
name = "fixture-app"
version = "0.1.0"
dependencies = [
    "py-test-001>=2,<3",
    "other[extra]==1.0; python_version < '3.12'",
]
classifiers = ["Programming Language :: Python"]

[project.optional-dependencies]
dev = ["pytest>=8"]

[dependency-groups]
dev = ["ruff"]
`;

describe("uv.lock parser", () => {
  it("normalises names, skips the editable root, marks direct deps", () => {
    const direct = pyprojectDirectDependencies(PYPROJECT);
    expect([...direct].sort()).toEqual(["other", "py-test-001", "pytest", "ruff"]);
    const pkgs = parseUvLock(UV_LOCK, PYPROJECT);
    expect(pkgs).toEqual([
      { name: "py-test-001", version: "2.5.0", direct: true },
      { name: "py-test-002", version: "0.9.1", direct: false },
    ]);
  });
});

describe(".terraform.lock.hcl parser", () => {
  it("lists providers with their pinned version", () => {
    const text = `provider "registry.terraform.io/hashicorp/google" {
  version     = "6.50.0"
  constraints = ">= 5.30.0, < 7.0.0"
  hashes = [
    "h1:abc=",
  ]
}
`;
    expect(parseTerraformLock(text)).toEqual([{ name: "registry.terraform.io/hashicorp/google", version: "6.50.0", direct: true }]);
  });
});

describe("discovery", () => {
  it("finds lockfiles recursively, skips node_modules, and resolves manifests", () => {
    const root = mkdtempSync(join(tmpdir(), "defender-discover-"));
    try {
      mkdirSync(join(root, "svc"), { recursive: true });
      mkdirSync(join(root, "node_modules", "x"), { recursive: true });
      mkdirSync(join(root, "infra", "envs", "dev"), { recursive: true });
      writeFileSync(join(root, "bun.lock"), BUN_LOCK);
      writeFileSync(join(root, "package.json"), "{}");
      writeFileSync(join(root, "svc", "package-lock.json"), NPM_LOCK);
      writeFileSync(join(root, "svc", "package.json"), "{}");
      writeFileSync(join(root, "node_modules", "x", "package-lock.json"), NPM_LOCK);
      writeFileSync(join(root, "infra", "envs", "dev", ".terraform.lock.hcl"), 'provider "a/b" {\n version = "1.0.0"\n}\n');
      const refs = discoverLockfiles(root);
      expect(refs.map((r) => r.path)).toEqual(["bun.lock", "infra/envs/dev/.terraform.lock.hcl", "svc/package-lock.json"]);
      expect(refs[0].manifestPath).toBe("package.json");
      expect(refs[1].manifestPath).toBe("infra/envs/dev");
      expect(refs[2].manifestPath).toBe("svc/package.json");
      const parsed = parseLockfile(root, refs[2]);
      expect(parsed.packages.length).toBe(4);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
