// package-lock.json lockfileVersion 2/3: the "packages" map is keyed by the
// install path ("node_modules/a/node_modules/b"); the package name is the
// segment after the last "node_modules/". The "" entry is the root manifest.

import type { LockedPackage } from "../types.js";

interface LockEntry {
  version?: string;
  link?: boolean;
  resolved?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  name?: string;
}

export function parseNpmLock(text: string): LockedPackage[] {
  const doc = JSON.parse(text) as { lockfileVersion?: number; packages?: Record<string, LockEntry> };
  if (!doc.packages) {
    throw new Error(`package-lock.json lockfileVersion ${doc.lockfileVersion ?? "unknown"} has no "packages" map; only v2/v3 are supported`);
  }

  const direct = new Set<string>();
  const root = doc.packages[""];
  for (const group of [root?.dependencies, root?.devDependencies, root?.optionalDependencies]) {
    for (const name of Object.keys(group ?? {})) direct.add(name);
  }

  const seen = new Map<string, LockedPackage>();
  for (const [key, entry] of Object.entries(doc.packages)) {
    if (key === "" || entry.link) continue;
    const idx = key.lastIndexOf("node_modules/");
    if (idx < 0) continue; // workspace package, not a registry install
    const name = entry.name ?? key.slice(idx + "node_modules/".length);
    const version = entry.version;
    if (!version) continue;
    const k = `${name}@${version}`;
    if (seen.has(k)) continue;
    seen.set(k, { name, version, direct: direct.has(name) });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}
