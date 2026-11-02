import { describe, it, expect } from "vitest";
import { parseCron, cronMatches } from "./cron.js";

// Local-time dates: new Date(y, m-1, d, h, min).
const at = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m - 1, d, h, min);

describe("parseCron", () => {
  it.each(["* * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * * 13 *", "* * * * 8", "a * * * *", "*/0 * * * *", "5-1 * * * *", "1,,2 * * * *"])(
    "rejects %s",
    (expr) => {
      expect(() => parseCron(expr)).toThrow(/cron/);
    },
  );

  it("accepts names, ranges, lists and steps", () => {
    const c = parseCron("0 2 * jan-mar mon,fri");
    expect([...c.month]).toEqual([1, 2, 3]);
    expect([...c.dayOfWeek].sort()).toEqual([1, 5]);
    expect([...parseCron("*/15 * * * *").minute]).toEqual([0, 15, 30, 45]);
    expect([...parseCron("* * * * 7").dayOfWeek]).toEqual([0]);
  });
});

describe("cronMatches", () => {
  it.each<[string, Date, boolean]>([
    ["* * * * *", at(2026, 10, 26, 3, 4), true],
    ["0 2 * * *", at(2026, 10, 26, 2, 0), true],
    ["0 2 * * *", at(2026, 10, 26, 2, 1), false],
    ["*/15 * * * *", at(2026, 10, 26, 2, 30), true],
    ["*/15 * * * *", at(2026, 10, 26, 2, 31), false],
    ["0 20 * * 5", at(2026, 10, 30, 20, 0), true], // 2026-10-30 is a Friday
    ["0 20 * * 5", at(2026, 10, 29, 20, 0), false],
    ["0 9 1 * *", at(2026, 11, 1, 9, 0), true],
    ["0 9 1 * *", at(2026, 11, 2, 9, 0), false],
  ])("%s at %s -> %s", (expr, date, expected) => {
    expect(cronMatches(parseCron(expr), date)).toBe(expected);
  });

  it("ORs day-of-month and day-of-week when both are restricted (POSIX)", () => {
    const c = parseCron("0 9 15 * mon");
    expect(cronMatches(c, at(2026, 10, 15, 9, 0))).toBe(true); // 15th (a Thursday)
    expect(cronMatches(c, at(2026, 10, 19, 9, 0))).toBe(true); // a Monday
    expect(cronMatches(c, at(2026, 10, 20, 9, 0))).toBe(false);
  });
});
