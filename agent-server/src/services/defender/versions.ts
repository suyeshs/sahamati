// Minimal version comparison covering semver (npm, crates.io) and the common
// PEP 440 shapes uv emits. Good enough to answer "is toVersion >= fixedVersion"
// for the patcher's validator; it is not a full semver range engine on purpose
// (no new dependency, and ranges are never needed here).

interface Parsed {
  release: number[];
  /** Pre-release tag parts; empty means a final release (sorts after any pre). */
  pre: Array<number | string>;
}

const PEP440_PRE = /^(a|b|rc|alpha|beta|c|pre|preview|dev|post)\.?(\d*)$/i;

function parse(input: string): Parsed {
  let s = input.trim();
  if (s.startsWith("v") || s.startsWith("V")) s = s.slice(1);
  if (s.startsWith("=")) s = s.replace(/^=+/, "");
  const plus = s.indexOf("+");
  if (plus >= 0) s = s.slice(0, plus);

  // Separate the pre-release/hyphen segment (semver) or trailing letters (pep440).
  let releasePart = s;
  let prePart = "";
  const dash = s.indexOf("-");
  if (dash >= 0) {
    releasePart = s.slice(0, dash);
    prePart = s.slice(dash + 1);
  } else {
    const m = s.match(/^(\d+(?:\.\d+)*)[.]?((?:a|b|rc|alpha|beta|c|pre|preview|dev|post)\d*.*)$/i);
    if (m) {
      releasePart = m[1];
      prePart = m[2];
    }
  }

  const release = releasePart
    .split(".")
    .map((p) => parseInt(p, 10))
    .map((n) => (Number.isFinite(n) ? n : 0));
  while (release.length > 1 && release[release.length - 1] === 0) release.pop();

  const pre: Array<number | string> = [];
  if (prePart) {
    for (const piece of prePart.split(/[.\-]/)) {
      if (piece === "") continue;
      const m = piece.match(PEP440_PRE);
      if (m) {
        pre.push(m[1].toLowerCase());
        if (m[2]) pre.push(parseInt(m[2], 10));
        continue;
      }
      const n = Number(piece);
      pre.push(Number.isInteger(n) ? n : piece.toLowerCase());
    }
  }
  return { release, pre };
}

function cmpRelease(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function cmpPre(a: Array<number | string>, b: Array<number | string>): number {
  // A "post" release sorts after the final release; everything else sorts before.
  const isPost = (p: Array<number | string>) => p[0] === "post";
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return isPost(b) ? -1 : 1;
  if (b.length === 0) return isPost(a) ? 1 : -1;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x < y ? -1 : 1;
    if (typeof x === "number") return -1; // numeric identifiers sort before alphanumerics
    if (typeof y === "number") return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** Negative when a < b, zero when equal, positive when a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  const r = cmpRelease(pa.release, pb.release);
  if (r !== 0) return r;
  return cmpPre(pa.pre, pb.pre);
}

export function versionGte(a: string, b: string): boolean {
  return compareVersions(a, b) >= 0;
}

export function versionLt(a: string, b: string): boolean {
  return compareVersions(a, b) < 0;
}

/** Loose syntactic check used by the tool schemas; semantic checks happen in code. */
export const VERSION_PATTERN = /^v?\d+(\.\d+){0,3}([.\-+][0-9A-Za-z.\-]+)?$/;
