import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Runner is now a registry adapter; drive it against a real encrypted DB.
// Env must be set before the DB module is imported (it resolves paths at import).
let dbmod: typeof import("../db/index.js");
let runner: typeof import("./runner.js");
let registry: typeof import("../db/repositories/agent-repo.js");
let root: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "sahamati-runner-"));
  process.env.__SAHAMATI_ROOT = root;
  process.env.SAHAMATI_DB_KEY = "test-key-0123456789abcdef0123456789abcdef";
  dbmod = await import("../db/index.js");
  dbmod.initDb();
  runner = await import("./runner.js");
  registry = await import("../db/repositories/agent-repo.js");
});

afterAll(() => {
  dbmod.closeDb();
  rmSync(root, { recursive: true, force: true });
  delete process.env.__SAHAMATI_ROOT;
  delete process.env.SAHAMATI_DB_KEY;
});

describe("runner adapter — seeding built-ins", () => {
  it("seeds documentation + evernote into the registry", () => {
    runner.seedBuiltInAgents();
    const names = runner.listAgents().map((a) => a.name).sort();
    expect(names).toContain("documentation");
    expect(names).toContain("evernote");

    const doc = runner.getAgent("documentation")!;
    expect(doc.soul).toContain("Documentation Agent");
    expect(doc.soul).toContain("## Skill: discovery"); // skills flattened inline
    expect(doc.llmModel).toBe("sonnet");
    expect(doc.tools).toContain("- **read**");
  });

  it("is idempotent — reseeding does not add revisions", () => {
    runner.seedBuiltInAgents();
    runner.seedBuiltInAgents();
    expect(runner.listAgents().filter((a) => a.name === "evernote")).toHaveLength(1);
    expect(registry.listRevisions("evernote")).toHaveLength(1);
  });
});

describe("runner adapter — CRUD maps to registry revisions", () => {
  it("creates an agent, slugifying the name", () => {
    const cfg = runner.createAgent({
      name: "My Helper",
      displayName: "My Helper",
      description: "helps",
      soul: "You are a helper.",
      tools: "- read\n- write",
      identity: "Be concise.",
      llmProvider: "anthropic",
      llmModel: "haiku",
    });
    expect(cfg.name).toBe("my-helper");
    expect(cfg.soul).toContain("You are a helper.");
    expect(cfg.soul).toContain("## Identity\nBe concise."); // identity folded in
    expect(cfg.llmModel).toBe("haiku");

    const def = registry.getAgentDefinition("my-helper")!;
    expect(def.tools).toEqual(["Read", "Write"]);
  });

  it("updates as a new revision, preserving history", () => {
    runner.updateAgent("my-helper", { tools: "- read\n- grep\n- bash" });
    const revs = registry.listRevisions("my-helper");
    expect(revs).toHaveLength(2);
    expect(registry.getAgentDefinition("my-helper")!.tools).toEqual(["Read", "Grep", "Bash"]);
  });

  it("installing a skill appends to the prompt as a new revision", () => {
    const before = registry.listRevisions("my-helper").length;
    runner.installSkill("my-helper", "SKILL-summarize.md", "Summarize crisply.");
    expect(registry.listRevisions("my-helper")).toHaveLength(before + 1);
    expect(runner.getAgent("my-helper")!.soul).toContain("## Skill: summarize");
  });

  it("deletes (archives): gone from listing, unrunnable, history retained", () => {
    expect(runner.deleteAgent("my-helper")).toBe(true);
    expect(runner.getAgent("my-helper")).toBeNull();
    expect(runner.listAgents().map((a) => a.name)).not.toContain("my-helper");
    expect(registry.listRevisions("my-helper").length).toBeGreaterThan(0);
  });

  it("deleting an unknown agent returns false", () => {
    expect(runner.deleteAgent("nope")).toBe(false);
  });
});
