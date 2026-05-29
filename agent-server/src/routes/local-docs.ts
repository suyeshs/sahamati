import { Hono } from "hono";
import { z } from "zod";

import { findRepoRoot, NotAGitRepoError } from "../cli/lib/repo.js";
import { initRepo } from "../cli/lib/init.js";
import { generateDraft } from "../cli/lib/generate.js";
import { listDrafts } from "../cli/lib/drafts.js";
import { publishDraft } from "../cli/lib/publish.js";
import { isDocType, DOC_TYPES } from "../cli/lib/templates.js";
import { rmSync } from "node:fs";

/**
 * Local-folder documentation routes used by the desktop GUI.
 *
 * These mirror the `sahamati` CLI: the GUI passes an absolute filesystem
 * path the user picked, and we run the same generate/publish flow against
 * the git repo that contains it. No project DB, auth, or sync involved —
 * the repo on disk is the source of truth.
 */
const local = new Hono();

const pathSchema = z.object({ path: z.string().min(1) });

function resolveRepo(path: string): string {
  return findRepoRoot(path);
}

function gitError(err: unknown): { status: 400; body: { error: string } } | null {
  if (err instanceof NotAGitRepoError) {
    return { status: 400, body: { error: err.message } };
  }
  return null;
}

// Resolve the repo root for a picked path and report whether it's scaffolded.
local.post("/api/local/resolve", async (c) => {
  const parsed = pathSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "path is required" }, 400);
  try {
    const repoRoot = resolveRepo(parsed.data.path);
    const drafts = listDrafts(repoRoot);
    return c.json({ repoRoot, draftCount: drafts.length });
  } catch (err) {
    const g = gitError(err);
    if (g) return c.json(g.body, g.status);
    throw err;
  }
});

local.post("/api/local/init", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = pathSchema.extend({ force: z.boolean().optional() }).safeParse(body);
  if (!parsed.success) return c.json({ error: "path is required" }, 400);
  try {
    const repoRoot = resolveRepo(parsed.data.path);
    const result = initRepo(repoRoot, parsed.data.force ?? false);
    return c.json({ repoRoot, ...result });
  } catch (err) {
    const g = gitError(err);
    if (g) return c.json(g.body, g.status);
    throw err;
  }
});

const docSchema = pathSchema.extend({
  type: z.string(),
  brief: z.string().min(1),
});

// Generate a draft. `claude -p --output-format text` buffers its output, so
// this is a single request→response: it resolves once the draft is written.
local.post("/api/local/doc", async (c) => {
  const parsed = docSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "path, type and brief are required" }, 400);
  const { path, type, brief } = parsed.data;
  if (!isDocType(type)) {
    return c.json({ error: `Unknown doc type: ${type}. Available: ${DOC_TYPES.join(", ")}` }, 400);
  }

  let repoRoot: string;
  try {
    repoRoot = resolveRepo(path);
  } catch (err) {
    const g = gitError(err);
    if (g) return c.json(g.body, g.status);
    throw err;
  }

  try {
    const result = await generateDraft(repoRoot, type, brief);
    return c.json({
      repoRoot,
      draftRel: result.draftRel,
      filename: result.filename,
      content: result.content,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

local.get("/api/local/drafts", (c) => {
  const path = c.req.query("path");
  if (!path) return c.json({ error: "path query param is required" }, 400);
  try {
    const repoRoot = resolveRepo(path);
    const drafts = listDrafts(repoRoot).map((d) => ({
      filename: d.filename,
      relPath: d.relPath,
      ageDays: d.ageDays,
      size: d.size,
    }));
    return c.json({ repoRoot, drafts });
  } catch (err) {
    const g = gitError(err);
    if (g) return c.json(g.body, g.status);
    throw err;
  }
});

const publishSchema = pathSchema.extend({
  filename: z.string().optional(),
  commit: z.boolean().optional(),
});

local.post("/api/local/publish", async (c) => {
  const parsed = publishSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "path is required" }, 400);
  try {
    const repoRoot = resolveRepo(parsed.data.path);
    const result = publishDraft(repoRoot, parsed.data.filename, {
      commit: parsed.data.commit ?? true,
    });
    const code = result.status === "published" ? 200 : 409;
    return c.json(result, code);
  } catch (err) {
    const g = gitError(err);
    if (g) return c.json(g.body, g.status);
    throw err;
  }
});

const discardSchema = pathSchema.extend({ filename: z.string().min(1) });

local.post("/api/local/discard", async (c) => {
  const parsed = discardSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "path and filename are required" }, 400);
  try {
    const repoRoot = resolveRepo(parsed.data.path);
    const draft = listDrafts(repoRoot).find((d) => d.filename === parsed.data.filename);
    if (!draft) return c.json({ error: `Draft not found: ${parsed.data.filename}` }, 404);
    rmSync(draft.path);
    return c.json({ status: "discarded", filename: parsed.data.filename });
  } catch (err) {
    const g = gitError(err);
    if (g) return c.json(g.body, g.status);
    throw err;
  }
});

export default local;
