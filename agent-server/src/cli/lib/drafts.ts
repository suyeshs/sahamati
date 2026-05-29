import { readdirSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";

import { todayISO, slugify } from "./repo.js";
import type { DocType } from "./templates.js";

export const DRAFTS_DIR = "docs/.drafts";

const PHASE_BY_TYPE: Record<DocType, string> = {
  brd: "discovery",
  intent: "discovery",
  architecture: "design",
  security: "testing",
  story: "requirements",
};

export interface DraftPaths {
  draftRel: string;
  draftAbs: string;
  publishRel: string;
  publishAbs: string;
  filename: string;
  date: string;
}

export function buildDraftPaths(
  repoRoot: string,
  type: DocType,
  brief: string,
  repoSlug: string
): DraftPaths {
  const date = todayISO();
  const briefSlug = slugify(brief).slice(0, 40).replace(/-+$/, "") || "doc";
  const filename = `${type}-${briefSlug}-${date}.md`;
  const draftRel = join(DRAFTS_DIR, filename);
  const phase = PHASE_BY_TYPE[type];
  const publishRel = join("docs", "projects", repoSlug, phase, filename);
  return {
    draftRel,
    draftAbs: join(repoRoot, draftRel),
    publishRel,
    publishAbs: join(repoRoot, publishRel),
    filename,
    date,
  };
}

export interface DraftEntry {
  filename: string;
  path: string;
  relPath: string;
  ageDays: number;
  size: number;
}

export function listDrafts(repoRoot: string): DraftEntry[] {
  const dir = join(repoRoot, DRAFTS_DIR);
  let entries: string[] = [];
  try {
    entries = readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  const now = Date.now();
  return entries
    .map((filename) => {
      const path = join(dir, filename);
      const st = statSync(path);
      return {
        filename,
        path,
        relPath: relative(repoRoot, path),
        ageDays: Math.floor((now - st.mtimeMs) / 86_400_000),
        size: st.size,
      };
    })
    .sort((a, b) => a.ageDays - b.ageDays);
}

export function publishPathForDraft(
  repoRoot: string,
  draftFilename: string,
  repoSlug: string
): { publishRel: string; publishAbs: string } {
  const type = inferTypeFromFilename(draftFilename);
  const phase = type ? PHASE_BY_TYPE[type] : "discovery";
  const publishRel = join("docs", "projects", repoSlug, phase, basename(draftFilename));
  return { publishRel, publishAbs: join(repoRoot, publishRel) };
}

function inferTypeFromFilename(filename: string): DocType | null {
  const m = filename.match(/^(brd|intent|architecture|security|story)-/i);
  if (!m) return null;
  return m[1].toLowerCase() as DocType;
}
