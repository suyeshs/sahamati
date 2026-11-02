// Cargo.lock (v3/v4) is a flat TOML list of [[package]] tables with scalar
// name/version/source fields. A hand-rolled block scanner is enough and avoids a
// TOML dependency. Direct dependencies come from the sibling Cargo.toml's
// [dependencies] / [dev-dependencies] / [build-dependencies] sections.

import type { LockedPackage } from "../types.js";

function tomlString(line: string, key: string): string | null {
  const m = line.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`));
  return m ? m[1] : null;
}

/** Names declared in Cargo.toml dependency sections (including target-specific ones). */
export function cargoDirectDependencies(manifest: string): Set<string> {
  const direct = new Set<string>();
  let inDeps = false;
  for (const raw of manifest.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inDeps = /^\[(target\.[^\]]+\.)?(dependencies|dev-dependencies|build-dependencies)\]$/.test(line);
      // Inline table-per-dependency form: [dependencies.serde]
      const m = line.match(/^\[(?:target\.[^\]]+\.)?(?:dependencies|dev-dependencies|build-dependencies)\.([^\]]+)\]$/);
      if (m) direct.add(m[1].replace(/"/g, ""));
      continue;
    }
    if (!inDeps || !line || line.startsWith("#")) continue;
    const m = line.match(/^("?)([A-Za-z0-9_\-]+)\1\s*=/);
    if (m) {
      // `package = "real-name"` renames: prefer the crate's real name.
      const renamed = line.match(/package\s*=\s*"([^"]+)"/);
      direct.add(renamed ? renamed[1] : m[2]);
    }
  }
  return direct;
}

export function parseCargoLock(text: string, manifest: string | null): LockedPackage[] {
  const direct = manifest ? cargoDirectDependencies(manifest) : new Set<string>();
  const out: LockedPackage[] = [];
  let current: { name?: string; version?: string; source?: string } | null = null;

  const flush = () => {
    if (current?.name && current.version && current.source) {
      // Only registry crates are OSV-addressable; path/git crates are skipped.
      if (current.source.startsWith("registry+")) {
        out.push({ name: current.name, version: current.version, direct: direct.has(current.name) });
      }
    }
    current = null;
  };

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "[[package]]") {
      flush();
      current = {};
      continue;
    }
    if (!current) continue;
    const name = tomlString(line, "name");
    if (name !== null) current.name = name;
    const version = tomlString(line, "version");
    if (version !== null) current.version = version;
    const source = tomlString(line, "source");
    if (source !== null) current.source = source;
  }
  flush();
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}
