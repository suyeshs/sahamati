import { describe, it, expect } from "vitest";
import { compareVersions, versionGte } from "./versions.js";

describe("compareVersions", () => {
  it.each([
    ["1.2.3", "1.2.3", 0],
    ["1.2.3", "1.2.4", -1],
    ["1.10.0", "1.9.9", 1],
    ["2.0.0", "2.0", 0],
    ["v1.0.0", "1.0.0", 0],
    ["1.0.0-alpha", "1.0.0", -1],
    ["1.0.0-alpha.1", "1.0.0-alpha.2", -1],
    ["1.0.0-beta", "1.0.0-alpha", 1],
    ["1.0.0-rc.1", "1.0.0-beta.9", 1],
    ["1.0.0+build.5", "1.0.0", 0],
    // PEP 440 shapes
    ["2.5.0a1", "2.5.0", -1],
    ["2.5.0rc1", "2.5.0b3", 1],
    ["2.5.0.post1", "2.5.0", 1],
    ["4.15.0", "4.9.1", 1],
    ["0.0.4", "0.0.10", -1],
  ])("compare(%s, %s) = %i", (a, b, expected) => {
    expect(Math.sign(compareVersions(a, b))).toBe(expected);
  });

  it("versionGte is inclusive", () => {
    expect(versionGte("7.7.3", "7.7.3")).toBe(true);
    expect(versionGte("7.7.2", "7.7.3")).toBe(false);
    expect(versionGte("8.0.0", "7.7.3")).toBe(true);
  });
});
