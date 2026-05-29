import { mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";

import { listDrafts, publishPathForDraft } from "./drafts.js";
import { gitAddCommit, pathExists, repoSlug } from "./repo.js";

export interface PublishResult {
  status: "published" | "not-found" | "exists" | "ambiguous";
  filename?: string;
  publishRel?: string;
  committed?: boolean;
  sha?: string;
  candidates?: string[];
}

/**
 * Publish a staged draft: move it from docs/.drafts/ to
 * docs/projects/<slug>/<phase>/ and (optionally) git add + commit.
 * Shared by the `sahamati publish` CLI command and the local HTTP route.
 */
export function publishDraft(
  repoRoot: string,
  filename: string | undefined,
  options: { commit?: boolean } = {}
): PublishResult {
  const drafts = listDrafts(repoRoot);
  if (drafts.length === 0) return { status: "not-found" };

  let target = filename;
  if (!target) {
    if (drafts.length > 1) {
      return { status: "ambiguous", candidates: drafts.map((d) => d.filename) };
    }
    target = drafts[0].filename;
  }

  const draft = drafts.find((d) => d.filename === target);
  if (!draft) return { status: "not-found" };

  const slug = repoSlug(repoRoot);
  const { publishRel, publishAbs } = publishPathForDraft(repoRoot, draft.filename, slug);

  if (pathExists(publishAbs)) {
    return { status: "exists", filename: draft.filename, publishRel };
  }

  mkdirSync(dirname(publishAbs), { recursive: true });
  renameSync(draft.path, publishAbs);

  const result: PublishResult = {
    status: "published",
    filename: draft.filename,
    publishRel,
    committed: false,
  };

  if (options.commit !== false) {
    const message = `docs: ${draft.filename.replace(/\.md$/, "")}`;
    const committed = gitAddCommit(repoRoot, [publishRel], message);
    result.committed = committed.committed;
    result.sha = committed.sha;
  }

  return result;
}
