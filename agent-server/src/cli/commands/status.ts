import { listDrafts } from "../lib/drafts.js";
import { findRepoRoot } from "../lib/repo.js";

export function runStatusCommand(): number {
  const repoRoot = findRepoRoot();
  const drafts = listDrafts(repoRoot);

  if (drafts.length === 0) {
    process.stdout.write("No unpublished drafts.\n");
    return 0;
  }

  const stale = drafts.filter((d) => d.ageDays >= 7);
  process.stdout.write(`${drafts.length} unpublished draft${drafts.length === 1 ? "" : "s"} in ${repoRoot}:\n\n`);
  for (const d of drafts) {
    const age = d.ageDays === 0 ? "today" : `${d.ageDays}d ago`;
    const flag = d.ageDays >= 7 ? " ⚠" : "";
    process.stdout.write(`  ${d.filename}  (${age})${flag}\n`);
  }
  if (stale.length > 0) {
    process.stdout.write(`\n${stale.length} draft${stale.length === 1 ? "" : "s"} older than a week. Consider publishing or discarding.\n`);
  }
  process.stdout.write(`\nNext: sahamati publish [<filename>]   |   sahamati discard <filename>\n`);
  return 0;
}
