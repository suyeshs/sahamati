// .terraform.lock.hcl pins provider versions. Providers are not in OSV, so this
// is inventory only: it lets the report show what is pinned and lets a later
// iteration compare against the registry.

import type { LockedPackage } from "../types.js";

export function parseTerraformLock(text: string): LockedPackage[] {
  const out: LockedPackage[] = [];
  const blockRe = /provider\s+"([^"]+)"\s*\{([\s\S]*?)\n\}/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(text)) !== null) {
    const name = m[1];
    const v = m[2].match(/\bversion\s*=\s*"([^"]+)"/);
    if (!v) continue;
    out.push({ name, version: v[1], direct: true });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
