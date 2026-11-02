// Deterministic PR title and body. The model's summary is embedded as quoted
// text; everything structural (table, advisory links, test results) is built
// from DB rows so a reviewer can trust it independently of the model.

import type { Finding } from "../../db/repositories/scan-repo-types.js";
import type { Proposal } from "../../db/repositories/defender-repo.js";

export function buildPrTitle(proposals: Proposal[], manifestPath: string): string {
  if (proposals.length === 1) {
    const p = proposals[0];
    return `fix(deps): bump ${p.package} ${p.from_version} -> ${p.to_version} (${manifestPath})`;
  }
  return `fix(deps): bump ${proposals.length} vulnerable dependencies in ${manifestPath}`;
}

function advisoryLink(id: string): string {
  if (id.startsWith("GHSA-")) return `[${id}](https://github.com/advisories/${id})`;
  if (id.startsWith("CVE-")) return `[${id}](https://nvd.nist.gov/vuln/detail/${id})`;
  if (id.startsWith("RUSTSEC-")) return `[${id}](https://rustsec.org/advisories/${id})`;
  return `[${id}](https://osv.dev/vulnerability/${id})`;
}

export function buildPrBody(input: {
  proposals: Proposal[];
  findings: Finding[];
  summary: string;
  manifestPath: string;
  runId: string;
  scanId: string;
}): string {
  const byFinding = new Map(input.findings.map((f) => [f.id, f]));
  const rows = input.proposals.map((p) => {
    const f = byFinding.get(p.finding_id);
    const ids = f?.advisory_ids ? (JSON.parse(f.advisory_ids) as string[]) : [];
    const primary = f?.title ?? ids[0] ?? "";
    const links = Array.from(new Set([primary, ...ids]))
      .filter(Boolean)
      .slice(0, 3)
      .map(advisoryLink)
      .join(", ");
    return `| \`${p.package}\` | ${p.from_version} | ${p.to_version} | ${f?.severity ?? "?"} | ${f?.is_direct === 1 ? "direct" : "transitive"} | ${links} | ${p.test_summary ?? "n/a"} |`;
  });

  const quotedSummary = input.summary
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");

  return [
    `## Dependency security update: \`${input.manifestPath}\``,
    "",
    "Opened by the Sahamati Defender agent. Every bump below was applied by a deterministic tool in an isolated workspace, the lockfile was regenerated with install scripts disabled, and the project's own test or build command was run. Please review and merge; the agent never merges.",
    "",
    "| Package | From | To | Severity | Type | Advisories | Tests |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
    "### Agent summary",
    "",
    quotedSummary,
    "",
    "### Review checklist",
    "",
    "- [ ] Lockfile diff only touches the listed packages and their transitive updates",
    "- [ ] Changelog of each bump reviewed for breaking changes",
    "- [ ] CI is green",
    "",
    `<sub>defender run \`${input.runId.slice(0, 8)}\`, scan \`${input.scanId.slice(0, 8)}\`. Advisory data from OSV.dev. No regulated data was read by this run.</sub>`,
  ].join("\n");
}
