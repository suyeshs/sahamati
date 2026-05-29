import { rmSync } from "node:fs";

import { listDrafts } from "../lib/drafts.js";
import { findRepoRoot } from "../lib/repo.js";

export function runDiscardCommand(filename: string): number {
  if (!filename) {
    process.stderr.write("Specify a draft filename to discard.\nRun `sahamati status` to list drafts.\n");
    return 2;
  }

  const repoRoot = findRepoRoot();
  const drafts = listDrafts(repoRoot);
  const draft = drafts.find((d) => d.filename === filename);
  if (!draft) {
    process.stderr.write(`Draft not found: ${filename}\n`);
    return 1;
  }

  rmSync(draft.path);
  process.stdout.write(`✓ Discarded ${filename}\n`);
  return 0;
}
