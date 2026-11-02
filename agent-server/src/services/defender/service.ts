// Composes checkout -> scan -> (triage agent) and checkout -> patch agent, with
// a single in-flight guard shared by the scheduler and the manual routes so a
// target is never scanned or patched twice at once.

import type { ScanTarget, Scan, Finding, FindingDiff } from "../../db/repositories/scan-repo-types.js";
import { getTarget, getLatestCompletedScan } from "../../db/repositories/scan-repo.js";
import { getFinding } from "../../db/repositories/defender-repo.js";
import { defenderTriageAgent, defenderPatchAgent } from "../../agents/index.js";
import type { DefenderRunContext } from "../../tools/defender.js";
import { prepareCheckout, scanCheckout, type Checkout, type ProgressSink } from "./pipeline.js";
import { runDefenderAgent } from "./run-agent.js";
import { isFileTarget } from "./git.js";

export type ScanPhase = "scan" | "scan+triage";

const inFlight = new Map<string, Promise<unknown>>();

export function isInFlight(targetId: string): boolean {
  return inFlight.has(targetId);
}

export function inFlightCount(): number {
  return inFlight.size;
}

async function withInFlight<T>(targetId: string, fn: () => Promise<T>): Promise<T> {
  if (inFlight.has(targetId)) throw new InFlightError(targetId);
  const p = fn();
  inFlight.set(targetId, p);
  try {
    return await p;
  } finally {
    inFlight.delete(targetId);
  }
}

export class InFlightError extends Error {
  constructor(public readonly targetId: string) {
    super(`a defender run is already in progress for target ${targetId}`);
  }
}

export class TargetNotApprovedError extends Error {
  constructor(public readonly targetId: string) {
    super(`target ${targetId} has not been approved for scanning`);
  }
}

function assertApproved(target: ScanTarget): void {
  if (!target.approved_at || !target.active) throw new TargetNotApprovedError(target.id);
}

function buildContext(target: ScanTarget, checkout: Checkout, scanId: string, githubToken: string | undefined, log: (l: string) => void): DefenderRunContext {
  return {
    runId: checkout.runId,
    scanId,
    projectId: target.project_id,
    targetId: target.id,
    repoDir: checkout.repoDir,
    workspaceDir: checkout.workspace?.dir ?? null,
    readOnly: checkout.readOnly,
    githubToken,
    repo: checkout.repo,
    defaultBranch: checkout.defaultBranch,
    log,
  };
}

export interface ExecuteScanOptions {
  trigger: "manual" | "scheduled";
  triggeredBy?: string;
  phase: ScanPhase;
  githubToken?: string;
  onMessage?: ProgressSink;
}

export interface ExecuteScanResult {
  scan: Scan;
  findings: Finding[];
  diff: FindingDiff;
  triaged: boolean;
}

export function executeScan(targetId: string, opts: ExecuteScanOptions): Promise<ExecuteScanResult> {
  return withInFlight(targetId, async () => {
    const target = getTarget(targetId);
    if (!target) throw new Error(`target not found: ${targetId}`);
    assertApproved(target);
    const progress: ProgressSink = opts.onMessage ?? (() => {});
    const log = (line: string) => void progress({ type: "defender", phase: "log", line });

    const checkout = await prepareCheckout(target, { githubToken: opts.githubToken, onProgress: progress });
    try {
      const result = await scanCheckout(target, checkout, { trigger: opts.trigger, triggeredBy: opts.triggeredBy, onProgress: progress });
      let triaged = false;
      const openCount = result.findings.filter((f) => f.status === "open").length;
      if (opts.phase === "scan+triage" && openCount > 0) {
        await progress({ type: "defender", phase: "triage", findings: openCount });
        const ctx = buildContext(target, checkout, result.scan.id, opts.githubToken, log);
        await runDefenderAgent(
          defenderTriageAgent,
          `Triage every open finding of scan ${result.scan.id} for target "${target.label}". Start with list_findings.`,
          ctx,
          { onMessage: (m) => progress({ type: "agent", message: m }) },
        );
        triaged = true;
      }
      return { scan: result.scan, findings: result.findings, diff: result.diff, triaged };
    } finally {
      await checkout.workspace?.dispose();
    }
  });
}

export interface ExecutePatchOptions {
  findingIds: string[];
  githubToken: string;
  triggeredBy?: string;
  onMessage?: ProgressSink;
}

export interface ExecutePatchResult {
  scanId: string;
  messages: unknown[];
}

export function executePatch(targetId: string, opts: ExecutePatchOptions): Promise<ExecutePatchResult> {
  return withInFlight(targetId, async () => {
    const target = getTarget(targetId);
    if (!target) throw new Error(`target not found: ${targetId}`);
    assertApproved(target);
    if (isFileTarget(target.base_url)) throw new Error("file:// targets are scan-only; patching requires a GitHub repository target");
    const latest = getLatestCompletedScan(target.id);
    if (!latest) throw new Error("no completed scan for this target; run a scan first");
    for (const id of opts.findingIds) {
      const f = getFinding(id);
      if (!f || f.scan_id !== latest.id) throw new Error(`finding ${id} is not part of the latest scan ${latest.id}`);
    }
    const progress: ProgressSink = opts.onMessage ?? (() => {});
    const log = (line: string) => void progress({ type: "defender", phase: "log", line });

    const checkout = await prepareCheckout(target, { githubToken: opts.githubToken, onProgress: progress });
    try {
      const ctx = buildContext(target, checkout, latest.id, opts.githubToken, log);
      await progress({ type: "defender", phase: "patch", findings: opts.findingIds.length, branchBase: checkout.defaultBranch });
      const messages = await runDefenderAgent(
        defenderPatchAgent,
        `Remediate these findings from scan ${latest.id} for target "${target.label}": ${opts.findingIds.join(", ")}. Start with list_findings, then work one manifest at a time.`,
        ctx,
        { onMessage: (m) => progress({ type: "agent", message: m }) },
      );
      return { scanId: latest.id, messages };
    } finally {
      await checkout.workspace?.dispose();
    }
  });
}
