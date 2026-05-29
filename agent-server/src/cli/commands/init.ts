import { findRepoRoot } from "../lib/repo.js";
import { initRepo } from "../lib/init.js";

export interface InitCommandArgs {
  force?: boolean;
}

export function runInitCommand(args: InitCommandArgs): number {
  const repoRoot = findRepoRoot();
  const { created, skipped } = initRepo(repoRoot, args.force);

  process.stdout.write(`✓ sahamati initialized in ${repoRoot}\n\n`);
  if (created.length > 0) {
    process.stdout.write(`Created:\n${created.map((c) => `  + ${c}`).join("\n")}\n`);
  }
  if (skipped.length > 0) {
    process.stdout.write(
      `\nSkipped (already exists, use --force to overwrite):\n${skipped.map((c) => `  - ${c}`).join("\n")}\n`
    );
  }

  process.stdout.write(
    `\nNext steps:\n` +
      `  sahamati doc brd "describe the project here..."\n` +
      `  sahamati status\n` +
      `  sahamati publish\n` +
      `  git push    # triggers GitHub Pages deploy\n`
  );
  return 0;
}
