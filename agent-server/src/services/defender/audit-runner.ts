// Allow-listed package-manager audit commands. They corroborate OSV; they are
// never the source of fixed_version. Commands are fixed per ecosystem and run
// through execFile (no shell), with install scripts disabled.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { LockfileRef } from "./types.js";

const execFileAsync = promisify(execFile);

export interface AuditAdvisory {
  package: string;
  advisoryIds: string[];
  severity: string;
  title: string;
  url?: string;
  vulnerableRange?: string;
  tool: "npm" | "bun";
}

export interface AuditResult {
  tool: "npm" | "bun";
  cwd: string;
  ok: boolean;
  advisories: AuditAdvisory[];
  note?: string;
}

function extractIds(...texts: Array<string | undefined>): string[] {
  const ids = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(/\b(GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}|CVE-\d{4}-\d{4,})\b/gi)) {
      const id = m[1];
      // GHSA suffixes are lowercase by convention; CVE ids are uppercase.
      ids.add(id.toUpperCase().startsWith("GHSA-") ? `GHSA-${id.slice(5).toLowerCase()}` : id.toUpperCase());
    }
  }
  return [...ids];
}

async function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<{ stdout: string; code: number }> {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, CI: "1", NO_COLOR: "1" },
    });
    return { stdout, code: 0 };
  } catch (err) {
    // Audit commands exit non-zero when vulnerabilities exist; stdout still holds the JSON.
    const e = err as { stdout?: string; code?: number | string; killed?: boolean };
    if (e.killed) throw new Error(`${cmd} audit timed out after ${timeoutMs}ms`);
    return { stdout: e.stdout ?? "", code: typeof e.code === "number" ? e.code : 1 };
  }
}

/** npm audit --json: { vulnerabilities: { name: { severity, via: [{title,url,...}|string], range } } } */
function parseNpmAudit(stdout: string): AuditAdvisory[] {
  const doc = JSON.parse(stdout) as { vulnerabilities?: Record<string, { severity?: string; range?: string; via?: Array<string | { title?: string; url?: string; severity?: string; range?: string }> }> };
  const out: AuditAdvisory[] = [];
  for (const [name, v] of Object.entries(doc.vulnerabilities ?? {})) {
    for (const via of v.via ?? []) {
      if (typeof via === "string") continue; // transitive pointer, not an advisory
      out.push({
        package: name,
        advisoryIds: extractIds(via.url, via.title),
        severity: via.severity ?? v.severity ?? "unknown",
        title: via.title ?? "",
        url: via.url,
        vulnerableRange: via.range ?? v.range,
        tool: "npm",
      });
    }
  }
  return out;
}

/** bun audit --json mirrors the registry bulk-advisory shape: { name: [{ id, url, title, severity, vulnerable_versions }] } */
function parseBunAudit(stdout: string): AuditAdvisory[] {
  const doc = JSON.parse(stdout) as Record<string, unknown>;
  if (doc && typeof doc === "object" && "vulnerabilities" in doc) return parseNpmAudit(stdout).map((a) => ({ ...a, tool: "bun" as const }));
  const out: AuditAdvisory[] = [];
  for (const [name, list] of Object.entries(doc)) {
    if (!Array.isArray(list)) continue;
    for (const adv of list as Array<{ url?: string; title?: string; severity?: string; vulnerable_versions?: string }>) {
      out.push({
        package: name,
        advisoryIds: extractIds(adv.url, adv.title),
        severity: adv.severity ?? "unknown",
        title: adv.title ?? "",
        url: adv.url,
        vulnerableRange: adv.vulnerable_versions,
        tool: "bun",
      });
    }
  }
  return out;
}

export function toolAvailable(cmd: string): Promise<boolean> {
  return execFileAsync("which", [cmd]).then(() => true, () => false);
}

/**
 * Run the audit that matches the lockfile format. Returns null when no audit
 * applies (cargo/uv/terraform) or the tool is missing on this host.
 */
export async function runAuditFor(repoDir: string, ref: LockfileRef, timeoutMs = 120_000): Promise<AuditResult | null> {
  const cwd = join(repoDir, ref.path.includes("/") ? ref.path.slice(0, ref.path.lastIndexOf("/")) : ".");
  if (ref.format === "npm-lock-v3") {
    if (!(await toolAvailable("npm"))) return { tool: "npm", cwd, ok: false, advisories: [], note: "npm not on PATH" };
    const { stdout } = await run("npm", ["audit", "--json", "--ignore-scripts", "--no-fund", "--audit-level=none"], cwd, timeoutMs);
    try {
      return { tool: "npm", cwd, ok: true, advisories: parseNpmAudit(stdout) };
    } catch (err) {
      return { tool: "npm", cwd, ok: false, advisories: [], note: `npm audit output unparseable: ${String(err).slice(0, 200)}` };
    }
  }
  if (ref.format === "bun-lock") {
    if (!(await toolAvailable("bun"))) return { tool: "bun", cwd, ok: false, advisories: [], note: "bun not on PATH" };
    if (!existsSync(join(cwd, "package.json"))) return { tool: "bun", cwd, ok: false, advisories: [], note: "no package.json beside bun.lock" };
    const { stdout } = await run("bun", ["audit", "--json"], cwd, timeoutMs);
    try {
      return { tool: "bun", cwd, ok: true, advisories: parseBunAudit(stdout) };
    } catch (err) {
      return { tool: "bun", cwd, ok: false, advisories: [], note: `bun audit output unparseable: ${String(err).slice(0, 200)}` };
    }
  }
  return null;
}
