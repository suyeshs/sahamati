import { publishDraft } from "../lib/publish.js";
import { findRepoRoot } from "../lib/repo.js";

export interface PublishCommandArgs {
  filename?: string;
  noCommit?: boolean;
}

export function runPublishCommand(args: PublishCommandArgs): number {
  const repoRoot = findRepoRoot();
  const result = publishDraft(repoRoot, args.filename, { commit: !args.noCommit });

  switch (result.status) {
    case "not-found":
      if (args.filename) {
        process.stderr.write(`Draft not found: ${args.filename}\n`);
        return 1;
      }
      process.stdout.write("No drafts to publish.\n");
      return 0;
    case "ambiguous":
      process.stderr.write(
        `Multiple drafts found. Specify which one to publish:\n\n` +
          (result.candidates ?? []).map((f) => `  sahamati publish ${f}`).join("\n") +
          `\n`
      );
      return 2;
    case "exists":
      process.stderr.write(
        `Refusing to overwrite existing file: ${result.publishRel}\n` +
          `Move or delete it first, or rename the draft.\n`
      );
      return 1;
    case "published":
      process.stdout.write(`✓ Published ${result.filename}\n  → ${result.publishRel}\n`);
      if (args.noCommit) {
        process.stdout.write(`Skipped git commit (--no-commit). Stage and commit when ready.\n`);
      } else if (result.committed) {
        process.stdout.write(`✓ Committed (${result.sha?.slice(0, 7)}). Push when ready: git push\n`);
      } else {
        process.stdout.write(
          `Warning: nothing committed. File is at ${result.publishRel}; commit manually.\n`
        );
      }
      return 0;
  }
}
