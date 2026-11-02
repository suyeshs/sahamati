// Five-field POSIX cron evaluator (minute hour day-of-month month day-of-week).
// Deliberately small so the scheduler needs no new dependency. Matching is
// minute-granular against the server's local clock; the scheduler ticks once a
// minute and guards against double-firing itself.

export interface ParsedCron {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  /** True when both day fields are restricted; POSIX then ORs them. */
  bothDaysRestricted: boolean;
  source: string;
}

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function parseValue(raw: string, names: string[] | null, min: number, max: number, field: string): number {
  const lower = raw.toLowerCase();
  if (names) {
    const idx = names.indexOf(lower);
    if (idx >= 0) return idx + min;
  }
  if (!/^\d+$/.test(raw)) throw new Error(`cron: invalid ${field} value "${raw}"`);
  const n = parseInt(raw, 10);
  if (n < min || n > max) throw new Error(`cron: ${field} value ${n} out of range ${min}-${max}`);
  return n;
}

function parseField(
  raw: string,
  min: number,
  max: number,
  field: string,
  names: string[] | null,
): { set: Set<number>; restricted: boolean } {
  const set = new Set<number>();
  let restricted = false;
  for (const part of raw.split(",")) {
    if (part === "") throw new Error(`cron: empty list item in ${field}`);
    const [rangePart, stepPart] = part.split("/");
    if (stepPart !== undefined && !/^\d+$/.test(stepPart)) {
      throw new Error(`cron: invalid step "${stepPart}" in ${field}`);
    }
    const step = stepPart !== undefined ? parseInt(stepPart, 10) : 1;
    if (step < 1) throw new Error(`cron: step must be >= 1 in ${field}`);

    let lo: number;
    let hi: number;
    if (rangePart === "*") {
      lo = min;
      hi = max;
      if (stepPart !== undefined) restricted = true;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-");
      lo = parseValue(a, names, min, max, field);
      hi = parseValue(b, names, min, max, field);
      if (lo > hi) throw new Error(`cron: inverted range "${rangePart}" in ${field}`);
      restricted = true;
    } else {
      lo = parseValue(rangePart, names, min, max, field);
      hi = stepPart !== undefined ? max : lo;
      restricted = true;
    }
    for (let v = lo; v <= hi; v += step) set.add(v);
  }
  return { set, restricted };
}

export function parseCron(expression: string): ParsedCron {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`cron: expected 5 fields, got ${fields.length}`);
  }
  const minute = parseField(fields[0], 0, 59, "minute", null);
  const hour = parseField(fields[1], 0, 23, "hour", null);
  const dom = parseField(fields[2], 1, 31, "day-of-month", null);
  const month = parseField(fields[3], 1, 12, "month", MONTH_NAMES);
  const dow = parseField(fields[4], 0, 7, "day-of-week", DAY_NAMES);
  // 7 is an alias for Sunday.
  if (dow.set.has(7)) {
    dow.set.delete(7);
    dow.set.add(0);
  }
  return {
    minute: minute.set,
    hour: hour.set,
    dayOfMonth: dom.set,
    month: month.set,
    dayOfWeek: dow.set,
    bothDaysRestricted: dom.restricted && dow.restricted,
    source: expression.trim(),
  };
}

export function cronMatches(cron: ParsedCron, date: Date): boolean {
  if (!cron.minute.has(date.getMinutes())) return false;
  if (!cron.hour.has(date.getHours())) return false;
  if (!cron.month.has(date.getMonth() + 1)) return false;
  const domOk = cron.dayOfMonth.has(date.getDate());
  const dowOk = cron.dayOfWeek.has(date.getDay());
  return cron.bothDaysRestricted ? domOk || dowOk : domOk && dowOk;
}

/** Throws with a readable message when the expression is invalid. */
export function assertValidCron(expression: string): void {
  parseCron(expression);
}
