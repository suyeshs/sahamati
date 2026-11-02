import { describe, it, expect, vi, beforeEach } from "vitest";

const executeScan = vi.fn();
const isInFlight = vi.fn((_id: string) => false);
const inFlightCount = vi.fn(() => 0);
const listScheduledDependencyTargets = vi.fn();
const scanStartedThisMinute = vi.fn((_id: string, _now: Date) => false);

vi.mock("./service.js", () => ({
  executeScan: (...args: unknown[]) => executeScan(...args),
  isInFlight: (id: string) => isInFlight(id),
  inFlightCount: () => inFlightCount(),
  InFlightError: class InFlightError extends Error {},
}));
vi.mock("../../db/repositories/defender-repo.js", () => ({
  listScheduledDependencyTargets: () => listScheduledDependencyTargets(),
  scanStartedThisMinute: (id: string, now: Date) => scanStartedThisMinute(id, now),
}));
// The feed watch has its own tests; keep this suite focused on the scan cron path.
vi.mock("./cve-watch.js", () => ({
  runCveWatch: async () => ({ newAlerts: [] }),
  watchIsStale: () => false,
}));

const { createDefenderScheduler } = await import("./scheduler.js");

const target = (id: string, cron: string | null) => ({ id, label: id, schedule_cron: cron, approved_at: "x", active: 1 });

beforeEach(() => {
  executeScan.mockReset().mockResolvedValue({ findings: [], diff: { added: [], resolved: [] } });
  isInFlight.mockReset().mockReturnValue(false);
  inFlightCount.mockReset().mockReturnValue(0);
  scanStartedThisMinute.mockReset().mockReturnValue(false);
  listScheduledDependencyTargets.mockReset();
});

describe("defender scheduler tick", () => {
  const log = () => {};

  it("fires only targets whose cron matches the current minute", async () => {
    listScheduledDependencyTargets.mockReturnValue([target("a", "0 2 * * *"), target("b", "30 2 * * *")]);
    const s = createDefenderScheduler({ intervalMs: 0, log, githubToken: "t" });
    await s.tick(new Date(2026, 9, 26, 2, 0));
    expect(executeScan).toHaveBeenCalledTimes(1);
    expect(executeScan).toHaveBeenCalledWith("a", expect.objectContaining({ trigger: "scheduled", phase: "scan", githubToken: "t" }));
  });

  it("skips in-flight targets, the concurrency cap, and same-minute duplicates", async () => {
    listScheduledDependencyTargets.mockReturnValue([target("a", "* * * * *"), target("b", "* * * * *"), target("c", "* * * * *")]);
    isInFlight.mockImplementation((id: string) => id === "a");
    scanStartedThisMinute.mockImplementation((id: string) => id === "b");
    const s = createDefenderScheduler({ intervalMs: 0, log, maxConcurrent: 5 });
    await s.tick(new Date());
    expect(executeScan.mock.calls.map((c) => c[0])).toEqual(["c"]);

    executeScan.mockClear();
    inFlightCount.mockReturnValue(1);
    const capped = createDefenderScheduler({ intervalMs: 0, log, maxConcurrent: 1 });
    await capped.tick(new Date());
    expect(executeScan).not.toHaveBeenCalled();
  });

  it("tolerates invalid cron expressions and failing scans", async () => {
    listScheduledDependencyTargets.mockReturnValue([target("bad", "not a cron"), target("ok", "* * * * *")]);
    executeScan.mockRejectedValue(new Error("boom"));
    const lines: string[] = [];
    const s = createDefenderScheduler({ intervalMs: 0, log: (l) => lines.push(l) });
    await s.tick(new Date());
    await new Promise((r) => setTimeout(r, 0));
    expect(executeScan).toHaveBeenCalledTimes(1);
    expect(lines.some((l) => l.includes("invalid cron"))).toBe(true);
    expect(lines.some((l) => l.includes("scan failed for ok"))).toBe(true);
  });
});
