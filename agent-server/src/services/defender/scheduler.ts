// Minute-tick scheduler for approved dependency targets with a cron expression.
// Opt-in via SAHAMATI_DEFENDER_SCHEDULER=1 so the desktop sidecar never runs
// scans on its own; a server deployment sets the flag explicitly.

import { listScheduledDependencyTargets, scanStartedThisMinute } from "../../db/repositories/defender-repo.js";
import { parseCron, cronMatches } from "./cron.js";
import { executeScan, isInFlight, inFlightCount, InFlightError } from "./service.js";
import { runCveWatch, watchIsStale } from "./cve-watch.js";

export interface SchedulerHandle {
  stop(): void;
  /** Exposed for tests: run one tick against `now`. */
  tick(now?: Date): Promise<void>;
}

export interface SchedulerOptions {
  githubToken?: string;
  maxConcurrent?: number;
  intervalMs?: number;
  phase?: "scan" | "scan+triage";
  log?: (line: string) => void;
}

export function createDefenderScheduler(opts: SchedulerOptions = {}): SchedulerHandle {
  const log = opts.log ?? ((line: string) => console.log(`[defender-scheduler] ${line}`));
  const maxConcurrent = opts.maxConcurrent ?? Number(process.env.SAHAMATI_DEFENDER_MAX_CONCURRENT ?? 1);
  const phase = opts.phase ?? ((process.env.SAHAMATI_DEFENDER_SCHEDULE_PHASE as "scan" | "scan+triage" | undefined) ?? "scan");
  let timer: NodeJS.Timeout | null = null;

  const watchHours = Number(process.env.SAHAMATI_DEFENDER_CVE_WATCH_HOURS ?? 6);
  let watchRunning = false;

  // Feed check: cheap (OSV only, no clone), so it runs on its own cadence
  // independent of the per-target scan crons.
  const maybeWatch = async (now: Date) => {
    if (watchRunning || watchHours <= 0 || !watchIsStale(watchHours, now)) return;
    watchRunning = true;
    try {
      const r = await runCveWatch({ now, log });
      if (r.newAlerts.length) log(`CVE watch raised ${r.newAlerts.length} new alert(s)`);
    } catch (err) {
      log(`CVE watch failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      watchRunning = false;
    }
  };

  const tick = async (now = new Date()) => {
    void maybeWatch(now);
    let targets;
    try {
      targets = listScheduledDependencyTargets();
    } catch (err) {
      log(`could not list targets: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    for (const t of targets) {
      if (!t.schedule_cron) continue;
      let cron;
      try {
        cron = parseCron(t.schedule_cron);
      } catch (err) {
        log(`target ${t.id} has an invalid cron "${t.schedule_cron}": ${String(err)}`);
        continue;
      }
      if (!cronMatches(cron, now)) continue;
      if (isInFlight(t.id)) {
        log(`target ${t.label} is still running; skipping this tick`);
        continue;
      }
      if (inFlightCount() >= maxConcurrent) {
        log(`concurrency limit ${maxConcurrent} reached; ${t.label} will wait for its next slot`);
        continue;
      }
      if (scanStartedThisMinute(t.id, now)) continue;
      log(`starting scheduled scan for ${t.label} (${t.schedule_cron})`);
      executeScan(t.id, { trigger: "scheduled", phase, githubToken: opts.githubToken })
        .then((r) => log(`finished ${t.label}: ${r.findings.length} findings (${r.diff.added.length} new, ${r.diff.resolved.length} resolved)`))
        .catch((err) => {
          if (err instanceof InFlightError) return;
          log(`scan failed for ${t.label}: ${err instanceof Error ? err.message : String(err)}`);
        });
    }
  };

  return {
    tick,
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    // Started lazily by startDefenderScheduler so tests can drive tick() directly.
    ...(opts.intervalMs !== 0
      ? {
          start() {
            timer = setInterval(() => void tick(), opts.intervalMs ?? 60_000);
            timer.unref();
          },
        }
      : {}),
  } as SchedulerHandle & { start?: () => void };
}

let active: (SchedulerHandle & { start?: () => void }) | null = null;

/** Called once from index.ts. No-op unless SAHAMATI_DEFENDER_SCHEDULER=1. */
export function startDefenderScheduler(): SchedulerHandle | null {
  if (process.env.SAHAMATI_DEFENDER_SCHEDULER !== "1") {
    console.log("Defender scheduler: disabled (set SAHAMATI_DEFENDER_SCHEDULER=1 to enable)");
    return null;
  }
  const token = (process.env.SAHAMATI_DEFENDER_GITHUB_TOKEN ?? "").trim() || undefined;
  if (!token) {
    console.warn("Defender scheduler: SAHAMATI_DEFENDER_GITHUB_TOKEN is not set; only public and file:// targets can be scanned on schedule");
  }
  active = createDefenderScheduler({ githubToken: token });
  active.start?.();
  console.log("Defender scheduler: enabled (60s tick)");
  return active;
}

export function stopDefenderScheduler(): void {
  active?.stop();
  active = null;
}
