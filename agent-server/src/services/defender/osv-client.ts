// Read-only client for the public OSV.dev API. Two calls are used:
//   POST /v1/querybatch  -> which vuln ids affect each (ecosystem, name, version)
//   GET  /v1/vulns/{id}  -> the advisory record (ranges, severity, references)
// The cache is injected so this module stays DB-free and unit-testable; the
// pipeline wires it to the osv_cache table.

import { compareVersions, versionLt, versionGte } from "./versions.js";
import type { Ecosystem } from "./types.js";

export type OsvSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface OsvEvent {
  introduced?: string;
  fixed?: string;
  last_affected?: string;
}

export interface OsvAffected {
  package?: { ecosystem?: string; name?: string };
  ranges?: Array<{ type: string; events: OsvEvent[] }>;
  versions?: string[];
  database_specific?: Record<string, unknown>;
}

export interface OsvVuln {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  modified?: string;
  published?: string;
  severity?: Array<{ type: string; score: string }>;
  affected?: OsvAffected[];
  references?: Array<{ type: string; url: string }>;
  database_specific?: { severity?: string; [k: string]: unknown };
}

export interface OsvQuery {
  ecosystem: Ecosystem;
  name: string;
  version: string;
}

export interface OsvCache {
  get(key: string): string | null;
  put(key: string, payload: string): void;
}

export interface OsvClientOptions {
  fetchImpl?: typeof fetch;
  cache?: OsvCache;
  baseUrl?: string;
  /** Max queries per querybatch request. OSV caps at 1000; stay well below. */
  batchSize?: number;
  /** Cache freshness windows, in ms. */
  queryTtlMs?: number;
  vulnTtlMs?: number;
  now?: () => number;
  log?: (line: string) => void;
}

const DEFAULT_BASE = "https://api.osv.dev";
const RETRY_DELAYS_MS = [1000, 3000, 8000];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface CacheEnvelope<T> {
  at: number;
  value: T;
}

export class OsvClient {
  private readonly fetchImpl: typeof fetch;
  private readonly cache: OsvCache | null;
  private readonly baseUrl: string;
  private readonly batchSize: number;
  private readonly queryTtlMs: number;
  private readonly vulnTtlMs: number;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  /** HTTP requests actually sent (cache hits excluded). */
  requestCount = 0;

  constructor(opts: OsvClientOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.cache = opts.cache ?? null;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
    this.batchSize = Math.min(opts.batchSize ?? 500, 1000);
    this.queryTtlMs = opts.queryTtlMs ?? 24 * 60 * 60 * 1000;
    this.vulnTtlMs = opts.vulnTtlMs ?? 7 * 24 * 60 * 60 * 1000;
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
  }

  private cacheGet<T>(key: string, ttl: number): T | null {
    if (!this.cache) return null;
    const raw = this.cache.get(key);
    if (!raw) return null;
    try {
      const env = JSON.parse(raw) as CacheEnvelope<T>;
      if (this.now() - env.at > ttl) return null;
      return env.value;
    } catch {
      return null;
    }
  }

  private cachePut<T>(key: string, value: T): void {
    if (!this.cache) return;
    const env: CacheEnvelope<T> = { at: this.now(), value };
    this.cache.put(key, JSON.stringify(env));
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    this.requestCount++;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
          ...init,
          headers: { "content-type": "application/json", accept: "application/json", ...(init.headers ?? {}) },
        });
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`OSV ${path} returned ${res.status}`);
        } else if (!res.ok) {
          throw new Error(`OSV ${path} returned ${res.status}`);
        } else {
          return await res.json();
        }
      } catch (err) {
        lastErr = err;
      }
      if (attempt < RETRY_DELAYS_MS.length) {
        this.log(`osv: retrying ${path} after ${RETRY_DELAYS_MS[attempt]}ms (${String(lastErr)})`);
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  /** Vulnerability ids per query, in input order. Cached per (ecosystem, name, version). */
  async queryBatch(queries: OsvQuery[]): Promise<string[][]> {
    const results: string[][] = new Array(queries.length);
    const pending: number[] = [];
    for (let i = 0; i < queries.length; i++) {
      const q = queries[i];
      const cached = this.cacheGet<string[]>(queryKey(q), this.queryTtlMs);
      if (cached) results[i] = cached;
      else pending.push(i);
    }

    for (let start = 0; start < pending.length; start += this.batchSize) {
      const slice = pending.slice(start, start + this.batchSize);
      const body = {
        queries: slice.map((i) => ({
          package: { name: queries[i].name, ecosystem: queries[i].ecosystem },
          version: queries[i].version,
        })),
      };
      const json = (await this.request("/v1/querybatch", { method: "POST", body: JSON.stringify(body) })) as {
        results?: Array<{ vulns?: Array<{ id: string }>; next_page_token?: string }>;
      };
      const batch = json.results ?? [];
      slice.forEach((qi, k) => {
        const r = batch[k];
        const ids = (r?.vulns ?? []).map((v) => v.id);
        if (r?.next_page_token) this.log(`osv: ${queries[qi].name}@${queries[qi].version} has more results than one page; truncated`);
        results[qi] = ids;
        this.cachePut(queryKey(queries[qi]), ids);
      });
    }
    return results;
  }

  /** Full advisory record. Cached by id. */
  async getVuln(id: string): Promise<OsvVuln> {
    const key = `vuln:${id}`;
    const cached = this.cacheGet<OsvVuln>(key, this.vulnTtlMs);
    if (cached) return cached;
    const vuln = (await this.request(`/v1/vulns/${encodeURIComponent(id)}`, { method: "GET" })) as OsvVuln;
    this.cachePut(key, vuln);
    return vuln;
  }
}

export function queryKey(q: OsvQuery): string {
  return `query:${q.ecosystem}:${q.name}:${q.version}`;
}

// --- Advisory interpretation ------------------------------------------------

function ecosystemMatches(affected: OsvAffected, ecosystem: Ecosystem): boolean {
  const e = affected.package?.ecosystem ?? "";
  return e === ecosystem || e.startsWith(`${ecosystem}:`);
}

function nameMatches(affected: OsvAffected, name: string, ecosystem: Ecosystem): boolean {
  const n = affected.package?.name ?? "";
  if (ecosystem === "PyPI") return n.toLowerCase().replace(/[-_.]+/g, "-") === name.toLowerCase().replace(/[-_.]+/g, "-");
  return n === name;
}

/**
 * The smallest "fixed" version that resolves the advisory for the installed
 * version, or null when no fix is published. Walks each range's events in
 * order: a range is open from `introduced` until the next `fixed`.
 */
export function fixedVersionFor(vuln: OsvVuln, ecosystem: Ecosystem, name: string, installed: string): string | null {
  const candidates: string[] = [];
  for (const aff of vuln.affected ?? []) {
    if (!ecosystemMatches(aff, ecosystem) || !nameMatches(aff, name, ecosystem)) continue;
    for (const range of aff.ranges ?? []) {
      if (range.type !== "ECOSYSTEM" && range.type !== "SEMVER") continue;
      let introduced: string | null = null;
      for (const ev of range.events) {
        if (ev.introduced !== undefined) introduced = ev.introduced === "0" ? "0.0.0" : ev.introduced;
        if (ev.fixed !== undefined) {
          const inRange = introduced !== null && versionGte(installed, introduced) && versionLt(installed, ev.fixed);
          if (inRange) candidates.push(ev.fixed);
          introduced = null;
        }
        if (ev.last_affected !== undefined) introduced = null;
      }
    }
    // Explicit version lists with no fix info give nothing to recommend.
  }
  if (candidates.length === 0) {
    // Fall back to any fixed version above the installed one, even if the range
    // bookkeeping did not place `installed` inside it (OSV data is uneven).
    for (const aff of vuln.affected ?? []) {
      if (!ecosystemMatches(aff, ecosystem) || !nameMatches(aff, name, ecosystem)) continue;
      for (const range of aff.ranges ?? []) {
        for (const ev of range.events) {
          if (ev.fixed !== undefined && versionGte(ev.fixed, installed)) candidates.push(ev.fixed);
        }
      }
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort(compareVersions);
  return candidates[0];
}

/** CVSS v3.x base score from a vector string, or null when it cannot be computed. */
export function cvssBaseScore(vector: string): number | null {
  if (!/^CVSS:3\.[01]\//.test(vector)) return null;
  const parts = Object.fromEntries(
    vector
      .split("/")
      .slice(1)
      .map((kv) => kv.split(":") as [string, string]),
  );
  const AV: Record<string, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
  const AC: Record<string, number> = { L: 0.77, H: 0.44 };
  const UI: Record<string, number> = { N: 0.85, R: 0.62 };
  const CIA: Record<string, number> = { H: 0.56, L: 0.22, N: 0 };
  const scopeChanged = parts.S === "C";
  const PR: Record<string, number> = scopeChanged ? { N: 0.85, L: 0.68, H: 0.5 } : { N: 0.85, L: 0.62, H: 0.27 };
  const av = AV[parts.AV], ac = AC[parts.AC], pr = PR[parts.PR], ui = UI[parts.UI];
  const c = CIA[parts.C], i = CIA[parts.I], a = CIA[parts.A];
  if ([av, ac, pr, ui, c, i, a].some((v) => v === undefined)) return null;
  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact = scopeChanged ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15) : 6.42 * iss;
  const exploitability = 8.22 * av * ac * pr * ui;
  if (impact <= 0) return 0;
  const raw = scopeChanged ? Math.min(1.08 * (impact + exploitability), 10) : Math.min(impact + exploitability, 10);
  return Math.ceil(raw * 10 - 1e-9) / 10;
}

export function scoreToSeverity(score: number): OsvSeverity {
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  if (score > 0) return "low";
  return "info";
}

/** Severity from the advisory: GHSA's textual rating first, then a computed CVSS 3.x score. */
export function severityOf(vuln: OsvVuln): { severity: OsvSeverity; verified: boolean } {
  const text = (vuln.database_specific?.severity ?? "").toString().toLowerCase();
  if (text === "critical" || text === "high" || text === "low") return { severity: text, verified: true };
  if (text === "moderate" || text === "medium") return { severity: "medium", verified: true };
  for (const s of vuln.severity ?? []) {
    const score = cvssBaseScore(s.score);
    if (score !== null) return { severity: scoreToSeverity(score), verified: true };
  }
  // CVSS 4.0 or missing data: assume medium so it is not silently ignored.
  return { severity: "medium", verified: false };
}

/** Prefer GHSA ids (stable, human-readable) then CVE, then whatever OSV used. */
export function primaryAdvisoryId(vuln: OsvVuln): string {
  const ids = [vuln.id, ...(vuln.aliases ?? [])];
  return ids.find((x) => x.startsWith("GHSA-")) ?? ids.find((x) => x.startsWith("CVE-")) ?? vuln.id;
}
