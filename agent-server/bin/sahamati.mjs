#!/usr/bin/env node
// Launcher for the sahamati CLI.
// Prefers the Bun-compiled standalone binary (dist/sahamati) when present;
// otherwise falls back to running the TypeScript source via Bun, then tsx.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const compiled = resolve(root, "dist", "sahamati");
const src = resolve(root, "src", "cli.ts");
const args = process.argv.slice(2);

function run(cmd, cmdArgs) {
  return spawnSync(cmd, cmdArgs, { stdio: "inherit", env: process.env });
}

let result;
if (existsSync(compiled)) {
  result = run(compiled, args);
} else {
  // Dev fallback: Bun first (supports the text imports), then tsx.
  result = run("bun", [src, ...args]);
  if (result.error) {
    result = run("npx", ["--yes", "tsx", src, ...args]);
  }
}

process.exit(result.status ?? 1);
