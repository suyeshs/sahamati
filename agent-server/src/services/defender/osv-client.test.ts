import { describe, it, expect, vi } from "vitest";
import { OsvClient, fixedVersionFor, cvssBaseScore, severityOf, primaryAdvisoryId, queryKey, type OsvVuln, type OsvCache } from "./osv-client.js";

function memCache(): OsvCache & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return { store, get: (k) => store.get(k) ?? null, put: (k, v) => void store.set(k, v) };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("OsvClient.queryBatch", () => {
  it("chunks requests, preserves order and caches per package", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { queries: Array<{ package: { name: string } }> };
      calls.push({ url: String(url), body });
      return jsonResponse({ results: body.queries.map((q) => ({ vulns: q.package.name === "pkg-test-bad" ? [{ id: "GHSA-test-0001-0001" }] : [] })) });
    }) as unknown as typeof fetch;
    const cache = memCache();
    const client = new OsvClient({ fetchImpl, cache, batchSize: 2 });
    const queries = [
      { ecosystem: "npm" as const, name: "pkg-test-ok", version: "1.0.0" },
      { ecosystem: "npm" as const, name: "pkg-test-bad", version: "1.0.0" },
      { ecosystem: "PyPI" as const, name: "py-test-ok", version: "2.0.0" },
    ];
    const ids = await client.queryBatch(queries);
    expect(ids).toEqual([[], ["GHSA-test-0001-0001"], []]);
    expect(calls).toHaveLength(2); // 3 queries, batch size 2
    expect(cache.store.has(queryKey(queries[1]))).toBe(true);

    // Second call is served entirely from cache.
    const again = await client.queryBatch(queries);
    expect(again).toEqual(ids);
    expect(calls).toHaveLength(2);
  });

  it("retries on 429 then succeeds", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => (n++ === 0 ? jsonResponse({}, 429) : jsonResponse({ results: [{ vulns: [] }] }))) as unknown as typeof fetch;
    vi.useFakeTimers();
    const client = new OsvClient({ fetchImpl });
    const p = client.queryBatch([{ ecosystem: "npm", name: "pkg-test-001", version: "1.0.0" }]);
    await vi.runAllTimersAsync();
    expect(await p).toEqual([[]]);
    expect(n).toBe(2);
    vi.useRealTimers();
  });
});

const VULN: OsvVuln = {
  id: "GHSA-test-aaaa-bbbb",
  aliases: ["CVE-2026-00001"],
  summary: "Prototype pollution in pkg-test-001",
  database_specific: { severity: "HIGH" },
  affected: [
    {
      package: { ecosystem: "npm", name: "pkg-test-001" },
      ranges: [
        { type: "SEMVER", events: [{ introduced: "0" }, { fixed: "1.2.4" }, { introduced: "2.0.0" }, { fixed: "2.0.2" }] },
      ],
    },
    {
      package: { ecosystem: "PyPI", name: "Py_Test.001" },
      ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "3.0.0" }] }],
    },
  ],
};

describe("fixedVersionFor", () => {
  it("picks the fix for the range containing the installed version", () => {
    expect(fixedVersionFor(VULN, "npm", "pkg-test-001", "1.2.3")).toBe("1.2.4");
    expect(fixedVersionFor(VULN, "npm", "pkg-test-001", "2.0.1")).toBe("2.0.2");
  });
  it("normalises PyPI names", () => {
    expect(fixedVersionFor(VULN, "PyPI", "py-test-001", "2.9.0")).toBe("3.0.0");
  });
  it("returns null when no fix exists", () => {
    const noFix: OsvVuln = { id: "X", affected: [{ package: { ecosystem: "npm", name: "pkg-test-001" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }] }] }] };
    expect(fixedVersionFor(noFix, "npm", "pkg-test-001", "1.0.0")).toBeNull();
  });
  it("ignores other packages", () => {
    expect(fixedVersionFor(VULN, "npm", "pkg-test-002", "1.0.0")).toBeNull();
  });
});

describe("severity", () => {
  it("computes CVSS 3.1 base scores", () => {
    expect(cvssBaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H")).toBe(9.8);
    expect(cvssBaseScore("CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:C/C:L/I:L/A:N")).toBe(6.4);
    expect(cvssBaseScore("CVSS:3.0/AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N")).toBe(1.8);
    expect(cvssBaseScore("CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N")).toBeNull();
  });
  it("prefers the database rating, then CVSS, then medium/unverified", () => {
    expect(severityOf(VULN)).toEqual({ severity: "high", verified: true });
    expect(severityOf({ id: "x", severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }] })).toEqual({ severity: "critical", verified: true });
    expect(severityOf({ id: "x" })).toEqual({ severity: "medium", verified: false });
  });
  it("prefers GHSA ids as the primary id", () => {
    expect(primaryAdvisoryId(VULN)).toBe("GHSA-test-aaaa-bbbb");
    expect(primaryAdvisoryId({ id: "PYSEC-2026-1", aliases: ["CVE-2026-2"] })).toBe("CVE-2026-2");
  });
});
