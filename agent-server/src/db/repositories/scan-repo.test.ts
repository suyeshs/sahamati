import { describe, it, expect } from "vitest";
import {
  computeFingerprint,
  diffFindingsLists,
  summarizeFindings,
  type Finding,
} from "./scan-repo-types.js";

describe("computeFingerprint", () => {
  it("is stable across calls with the same inputs", () => {
    const a = computeFingerprint({ category: "tls", location: "/", title: "Weak cipher" });
    const b = computeFingerprint({ category: "tls", location: "/", title: "Weak cipher" });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("is insensitive to leading/trailing whitespace and case", () => {
    const a = computeFingerprint({ category: "TLS", location: "/", title: "Weak cipher" });
    const b = computeFingerprint({ category: " tls ", location: "/", title: " WEAK CIPHER " });
    expect(a).toBe(b);
  });

  it("differs when category, location, or title differs", () => {
    const base = computeFingerprint({ category: "tls", location: "/", title: "Weak cipher" });
    const diffCategory = computeFingerprint({ category: "headers", location: "/", title: "Weak cipher" });
    const diffLocation = computeFingerprint({ category: "tls", location: "/api", title: "Weak cipher" });
    const diffTitle = computeFingerprint({ category: "tls", location: "/", title: "Weak protocol" });
    expect(base).not.toBe(diffCategory);
    expect(base).not.toBe(diffLocation);
    expect(base).not.toBe(diffTitle);
  });
});

function makeFinding(partial: Partial<Finding> & Pick<Finding, "fingerprint" | "severity">): Finding {
  return {
    id: partial.id ?? "id-" + partial.fingerprint,
    scan_id: partial.scan_id ?? "scan-x",
    fingerprint: partial.fingerprint,
    severity: partial.severity,
    category: partial.category ?? "headers",
    cwe: partial.cwe ?? null,
    title: partial.title ?? "T",
    description: partial.description ?? "D",
    location: partial.location ?? "/",
    evidence: partial.evidence ?? null,
    remediation: partial.remediation ?? null,
    status: partial.status ?? "open",
    first_seen_scan_id: partial.first_seen_scan_id ?? null,
    created_at: partial.created_at ?? "now",
    ecosystem: partial.ecosystem ?? null,
    package: partial.package ?? null,
    installed_version: partial.installed_version ?? null,
    fixed_version: partial.fixed_version ?? null,
    advisory_ids: partial.advisory_ids ?? null,
    manifest_path: partial.manifest_path ?? null,
    is_direct: partial.is_direct ?? null,
    priority: partial.priority ?? null,
    reachability: partial.reachability ?? null,
    triage_note: partial.triage_note ?? null,
    remediation_pr_url: partial.remediation_pr_url ?? null,
    status_changed_at: partial.status_changed_at ?? null,
  };
}

describe("diffFindingsLists", () => {
  it("treats all current findings as added when previous is empty", () => {
    const current: Finding[] = [
      makeFinding({ fingerprint: "fp-a", severity: "high" }),
      makeFinding({ fingerprint: "fp-b", severity: "medium" }),
    ];
    const diff = diffFindingsLists([], current);
    expect(diff.added.map((f) => f.fingerprint)).toEqual(["fp-a", "fp-b"]);
    expect(diff.resolved).toEqual([]);
    expect(diff.severityUp).toEqual([]);
    expect(diff.reopened).toEqual([]);
  });

  it("flags added fingerprints", () => {
    const previous = [makeFinding({ fingerprint: "fp-a", severity: "low" })];
    const current = [
      makeFinding({ fingerprint: "fp-a", severity: "low" }),
      makeFinding({ fingerprint: "fp-b", severity: "high" }),
    ];
    const diff = diffFindingsLists(previous, current);
    expect(diff.added.map((f) => f.fingerprint)).toEqual(["fp-b"]);
    expect(diff.unchanged.map((f) => f.fingerprint)).toEqual(["fp-a"]);
  });

  it("flags resolved fingerprints (in previous open, not in current)", () => {
    const previous = [
      makeFinding({ fingerprint: "fp-a", severity: "low" }),
      makeFinding({ fingerprint: "fp-b", severity: "high" }),
    ];
    const current = [makeFinding({ fingerprint: "fp-a", severity: "low" })];
    const diff = diffFindingsLists(previous, current);
    expect(diff.resolved.map((f) => f.fingerprint)).toEqual(["fp-b"]);
  });

  it("does not flag previously-resolved findings as resolved again", () => {
    const previous = [makeFinding({ fingerprint: "fp-a", severity: "low", status: "resolved" })];
    const current: Finding[] = [];
    const diff = diffFindingsLists(previous, current);
    expect(diff.resolved).toEqual([]);
  });

  it("flags severity-up regressions", () => {
    const previous = [makeFinding({ fingerprint: "fp-a", severity: "low" })];
    const current = [makeFinding({ fingerprint: "fp-a", severity: "high" })];
    const diff = diffFindingsLists(previous, current);
    expect(diff.severityUp).toHaveLength(1);
    expect(diff.severityUp[0].previous.severity).toBe("low");
    expect(diff.severityUp[0].current.severity).toBe("high");
  });

  it("flags reopened findings (previously resolved, now open)", () => {
    const previous = [makeFinding({ fingerprint: "fp-a", severity: "high", status: "resolved" })];
    const current = [makeFinding({ fingerprint: "fp-a", severity: "high", status: "open" })];
    const diff = diffFindingsLists(previous, current);
    expect(diff.reopened.map((f) => f.fingerprint)).toEqual(["fp-a"]);
    expect(diff.added).toEqual([]);
  });
});

describe("summarizeFindings", () => {
  it("counts each severity bucket", () => {
    const findings = [
      makeFinding({ fingerprint: "1", severity: "critical" }),
      makeFinding({ fingerprint: "2", severity: "high" }),
      makeFinding({ fingerprint: "3", severity: "high" }),
      makeFinding({ fingerprint: "4", severity: "low" }),
    ];
    expect(summarizeFindings(findings)).toEqual({
      critical: 1,
      high: 2,
      medium: 0,
      low: 1,
      info: 0,
    });
  });

  it("returns all zeros for an empty list", () => {
    expect(summarizeFindings([])).toEqual({ critical: 0, high: 0, medium: 0, low: 0, info: 0 });
  });
});
