// uv.lock is TOML with [[package]] tables; registry packages carry
// `source = { registry = "..." }`, while the project itself is `editable` or
// `virtual`. Direct dependencies come from pyproject.toml's `dependencies` list
// (and optional/dev groups). PEP 508 specifiers are reduced to the bare name.

import type { LockedPackage } from "../types.js";

/** Normalise a PyPI name the way PEP 503 does so lockfile and manifest names match. */
export function normalizePyPiName(name: string): string {
  return name.trim().toLowerCase().replace(/[-_.]+/g, "-");
}

function pep508Name(spec: string): string | null {
  const m = spec.trim().match(/^([A-Za-z0-9][A-Za-z0-9._-]*)/);
  return m ? normalizePyPiName(m[1]) : null;
}

/** Names from every dependency array in pyproject.toml (project + optional + dependency-groups + tool.uv dev). */
export function pyprojectDirectDependencies(manifest: string): Set<string> {
  const direct = new Set<string>();
  // Capture every `something = [ ... ]` array and treat quoted strings inside as specifiers.
  // Scoped to arrays under keys that denote dependencies to avoid classifiers etc.
  // The closing bracket must end the line so that extras like "pkg[extra]" inside
  // a specifier do not terminate the array early.
  const arrayRe = /^\s*([A-Za-z0-9_.\-"]+)\s*=\s*\[([\s\S]*?)\](?=[ \t]*(?:#.*)?(?:\r?\n|$))/gm;
  let m: RegExpExecArray | null;
  while ((m = arrayRe.exec(manifest)) !== null) {
    const key = m[1].replace(/"/g, "");
    // Matches `dependencies`, `optional-dependencies.<extra>` arrays, and the
    // conventional `dev` group under [dependency-groups]. Other arrays
    // (classifiers, keywords) are skipped.
    const isDepKey = /dependencies$/.test(key) || key === "dev" || key === "dev-dependencies";
    if (!isDepKey) continue;
    const strRe = /"([^"]+)"|'([^']+)'/g;
    let s: RegExpExecArray | null;
    while ((s = strRe.exec(m[2])) !== null) {
      const name = pep508Name(s[1] ?? s[2]);
      if (name) direct.add(name);
    }
  }
  return direct;
}

export function parseUvLock(text: string, manifest: string | null): LockedPackage[] {
  const direct = manifest ? pyprojectDirectDependencies(manifest) : new Set<string>();
  const out: LockedPackage[] = [];
  let current: { name?: string; version?: string; registry?: boolean } | null = null;

  const flush = () => {
    if (current?.name && current.version && current.registry) {
      out.push({
        name: normalizePyPiName(current.name),
        version: current.version,
        direct: direct.has(normalizePyPiName(current.name)),
      });
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
    // Sub-tables like [package.metadata] end the scalar section but belong to the same package.
    const name = line.match(/^name\s*=\s*"([^"]+)"/);
    if (name && current.name === undefined) current.name = name[1];
    const version = line.match(/^version\s*=\s*"([^"]+)"/);
    if (version && current.version === undefined) current.version = version[1];
    if (/^source\s*=\s*\{/.test(line)) current.registry = /registry\s*=/.test(line);
  }
  flush();
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}
