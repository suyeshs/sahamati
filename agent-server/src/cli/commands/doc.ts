import { relative } from "node:path";

import { generateDraft } from "../lib/generate.js";
import { findRepoRoot } from "../lib/repo.js";
import { DOC_TYPES, DOC_TYPE_LABEL, isDocType } from "../lib/templates.js";

export interface DocCommandArgs {
  type: string;
  brief: string;
}

export async function runDocCommand(args: DocCommandArgs): Promise<number> {
  if (!isDocType(args.type)) {
    process.stderr.write(
      `Unknown doc type: ${args.type}\nAvailable: ${DOC_TYPES.join(", ")}\n`
    );
    return 2;
  }
  if (!args.brief.trim()) {
    process.stderr.write(
      'Doc brief is required.\nExample: sahamati doc brd "build a payments system for ..."\n'
    );
    return 2;
  }

  const repoRoot = findRepoRoot();

  process.stderr.write(
    `[sahamati] Generating ${DOC_TYPE_LABEL[args.type]}...\n` +
      `[sahamati] Repo: ${repoRoot}\n`
  );

  const result = await generateDraft(repoRoot, args.type, args.brief, {
    onProgress: () => process.stderr.write("."),
  });
  process.stderr.write("\n");

  process.stdout.write(
    `\n✓ Draft written to ${relative(process.cwd(), result.draftAbs)}\n` +
      `  Review it, then publish with:  sahamati publish ${result.filename}\n`
  );
  return 0;
}
