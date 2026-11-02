// bun.lock is JSONC: JSON with trailing commas and (rarely) comments. The
// "packages" map values are tuples whose first element is "name@version";
// nested resolutions use keys like "parent/child" but the tuple still names the
// package, so we read the tuple rather than the key.

import type { LockedPackage } from "../types.js";

function stripJsonc(text: string): string {
  // Remove // and /* */ comments outside strings, then trailing commas.
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inStr) {
      out += ch;
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
      continue;
    }
    out += ch;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

function splitNameVersion(spec: string): { name: string; version: string } | null {
  const at = spec.lastIndexOf("@");
  if (at <= 0) return null;
  return { name: spec.slice(0, at), version: spec.slice(at + 1) };
}

export function parseBunLock(text: string): LockedPackage[] {
  const doc = JSON.parse(stripJsonc(text)) as {
    workspaces?: Record<string, { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; peerDependencies?: Record<string, string> }>;
    packages?: Record<string, unknown[]>;
  };

  const direct = new Set<string>();
  for (const ws of Object.values(doc.workspaces ?? {})) {
    for (const group of [ws.dependencies, ws.devDependencies, ws.optionalDependencies]) {
      for (const name of Object.keys(group ?? {})) direct.add(name);
    }
  }

  const seen = new Map<string, LockedPackage>();
  for (const tuple of Object.values(doc.packages ?? {})) {
    const spec = tuple?.[0];
    if (typeof spec !== "string") continue;
    const nv = splitNameVersion(spec);
    if (!nv) continue;
    // Workspace links and git/tarball sources carry non-registry versions; keep
    // them only when the version looks like a registry version.
    if (!/^\d/.test(nv.version)) continue;
    const key = `${nv.name}@${nv.version}`;
    if (seen.has(key)) continue;
    seen.set(key, { name: nv.name, version: nv.version, direct: direct.has(nv.name) });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}
