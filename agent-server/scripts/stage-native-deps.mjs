#!/usr/bin/env node
// `bun build --compile` cannot embed native N-API addons. libsql require()s
// its platform package (@libsql/<triple>) at runtime, so the desktop bundle
// ships it as a Tauri resource (src-tauri/resources/node_modules) and the
// Tauri shell points the sidecar's NODE_PATH there (src-tauri/src/lib.rs).
// This script stages the addon for the build host's platform; run it before
// `tauri build` / `tauri dev`.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// process.platform-arch → @libsql platform package suffix
const LIBSQL_TRIPLES = {
  "darwin-arm64": "darwin-arm64",
  "darwin-x64": "darwin-x64",
  "linux-x64": "linux-x64-gnu",
  "linux-arm64": "linux-arm64-gnu",
  "win32-x64": "win32-x64-msvc",
};

const key = `${process.platform}-${process.arch}`;
const pkg = LIBSQL_TRIPLES[key];
if (!pkg) {
  console.error(`No @libsql platform package mapping for ${key}`);
  process.exit(1);
}

const src = join(here, "..", "node_modules", "@libsql", pkg);
if (!existsSync(join(src, "index.node"))) {
  console.error(`Missing ${src} — run \`bun install\` in agent-server/ first`);
  process.exit(1);
}

// Clear the staging dir so a platform switch can't leave a stale addon behind.
const stageRoot = join(here, "..", "..", "src-tauri", "resources", "node_modules");
rmSync(stageRoot, { recursive: true, force: true });
const dest = join(stageRoot, "@libsql", pkg);
mkdirSync(dirname(dest), { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`Staged @libsql/${pkg} → ${dest}`);
