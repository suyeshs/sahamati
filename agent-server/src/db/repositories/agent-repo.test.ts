import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// The DB module reads __SAHAMATI_ROOT / SAHAMATI_DB_KEY at import time to locate
// and open the encrypted database, so env must be set before it is imported.
// Import both modules dynamically inside beforeAll to guarantee that ordering.
let dbmod: typeof import("../index.js");
let repo: typeof import("./agent-repo.js");
let root: string;

const DEF = {
  displayName: "Evernote Agent",
  description: "Manages notes",
  systemPrompt: "You are the Evernote agent.",
  tools: ["Read", "Write", "Bash"],
  model: "sonnet",
  maxTurns: 20,
} as const;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "sahamati-agent-repo-"));
  process.env.__SAHAMATI_ROOT = root;
  process.env.SAHAMATI_DB_KEY = "test-key-0123456789abcdef0123456789abcdef";
  dbmod = await import("../index.js");
  dbmod.initDb();
  repo = await import("./agent-repo.js");
});

afterAll(() => {
  dbmod.closeDb();
  rmSync(root, { recursive: true, force: true });
  delete process.env.__SAHAMATI_ROOT;
  delete process.env.SAHAMATI_DB_KEY;
});

describe("agent registry — create + validate", () => {
  it("creates an agent at revision 1 with a validated definition", () => {
    const agent = repo.createAgent("evernote", DEF, { author: null, kind: "built_in" });
    expect(agent.name).toBe("evernote");
    expect(agent.status).toBe("active");
    expect(agent.current_revision_id).toBeTruthy();

    const def = repo.getAgentDefinition("evernote");
    expect(def).toMatchObject({ displayName: "Evernote Agent", tools: ["Read", "Write", "Bash"], maxTurns: 20 });
    expect(repo.listRevisions("evernote")).toHaveLength(1);
  });

  it("rejects a duplicate name", () => {
    expect(() => repo.createAgent("evernote", DEF)).toThrow(/already exists/);
  });

  it("rejects an invalid slug", () => {
    expect(() => repo.createAgent("Bad Name!", DEF)).toThrow(/Invalid agent name/);
  });

  it("rejects an invalid definition (unknown tool, empty prompt)", () => {
    expect(() => repo.createAgent("bad-tool", { ...DEF, tools: ["Nope"] })).toThrow();
    expect(() => repo.createAgent("empty-prompt", { ...DEF, systemPrompt: "" })).toThrow();
    expect(() => repo.createAgent("no-tools", { ...DEF, tools: [] })).toThrow();
  });

  it("applies schema defaults (description, maxTurns, llmProvider)", () => {
    repo.createAgent("minimal", {
      displayName: "Minimal",
      systemPrompt: "hi",
      tools: ["Read"],
      model: "haiku",
    });
    const def = repo.getAgentDefinition("minimal");
    expect(def).toMatchObject({ description: "", maxTurns: 30, llmProvider: "anthropic" });
  });
});

describe("agent registry — versioning", () => {
  it("appends a new revision on revise, merging a partial patch", () => {
    const before = repo.listRevisions("evernote")[0];
    repo.reviseAgent("evernote", { maxTurns: 40 }, { author: null, reason: "bump turns" });

    const revs = repo.listRevisions("evernote");
    expect(revs).toHaveLength(2);
    expect(revs[0].revision).toBe(2);
    expect(revs[0].change_reason).toBe("bump turns");

    const def = repo.getAgentDefinition("evernote")!;
    expect(def.maxTurns).toBe(40);
    // untouched fields are retained from the prior revision
    expect(def.systemPrompt).toBe("You are the Evernote agent.");
    // the definition actually changed → new content hash
    expect(revs[0].content_hash).not.toBe(before.content_hash);
  });

  it("keeps old revisions retrievable (immutable history)", () => {
    const revs = repo.listRevisions("evernote");
    const rev1 = revs.find((r) => r.revision === 1)!;
    expect(rev1.max_turns).toBe(20); // original value preserved
  });

  it("rolls back by copying an old revision forward as a new one", () => {
    const rev1 = repo.listRevisions("evernote").find((r) => r.revision === 1)!;
    repo.rollbackAgent("evernote", 1, { author: null });

    const revs = repo.listRevisions("evernote");
    expect(revs[0].revision).toBe(3);
    expect(revs[0].change_reason).toBe("rollback to revision 1");
    // rolled-back state equals the original → identical content hash, forward revision
    expect(revs[0].content_hash).toBe(rev1.content_hash);
    expect(repo.getAgentDefinition("evernote")!.maxTurns).toBe(20);
  });
});

describe("agent registry — immutability + lifecycle", () => {
  it("blocks in-place UPDATE of a revision at the DB layer", () => {
    const rev = repo.listRevisions("evernote")[0];
    expect(() =>
      dbmod
        .getDb()
        .prepare("UPDATE agent_revisions SET description = 'tampered' WHERE id = ?")
        .run(rev.id),
    ).toThrow(/append-only/);
  });

  it("archives an agent: not runnable, excluded from listing, history retained", () => {
    repo.createAgent("temp", DEF);
    repo.archiveAgent("temp");

    expect(repo.getAgentDefinition("temp")).toBeNull();
    expect(repo.listAgents().map((a) => a.name)).not.toContain("temp");
    expect(repo.getAgent("temp")!.status).toBe("archived");
    expect(repo.listRevisions("temp").length).toBeGreaterThan(0); // audit trail survives
  });

  it("lists active agents with a current-revision summary", () => {
    const names = repo.listAgents().map((a) => a.name);
    expect(names).toContain("evernote");
    const evernote = repo.listAgents().find((a) => a.name === "evernote")!;
    expect(evernote.revision).toBe(3);
    expect(evernote.tool_count).toBe(3);
  });
});
