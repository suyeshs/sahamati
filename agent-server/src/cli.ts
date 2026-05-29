#!/usr/bin/env node
import { runDocCommand } from "./cli/commands/doc.js";
import { runStatusCommand } from "./cli/commands/status.js";
import { runPublishCommand } from "./cli/commands/publish.js";
import { runDiscardCommand } from "./cli/commands/discard.js";
import { runInitCommand } from "./cli/commands/init.js";
import { DOC_TYPES } from "./cli/lib/templates.js";
import { NotAGitRepoError } from "./cli/lib/repo.js";

const HELP = `sahamati — generate, stage, and publish project docs from your repo.

Usage:
  sahamati init [--force]
  sahamati doc <type> "<brief>"      types: ${DOC_TYPES.join(", ")}
  sahamati status
  sahamati publish [<filename>] [--no-commit]
  sahamati discard <filename>
  sahamati version
  sahamati help

The CLI operates on the git repository containing the current working
directory. Drafts are written to docs/.drafts/ (excluded from mkdocs
output). \`sahamati publish\` moves them under docs/projects/<slug>/<phase>/
and commits.`;

const VERSION = "0.1.0";

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const rest = argv.slice(1);

  if (!cmd || cmd === "help" || cmd === "-h" || cmd === "--help") {
    process.stdout.write(HELP + "\n");
    return 0;
  }
  if (cmd === "version" || cmd === "-v" || cmd === "--version") {
    process.stdout.write(VERSION + "\n");
    return 0;
  }

  switch (cmd) {
    case "init": {
      const force = rest.includes("--force") || rest.includes("-f");
      return runInitCommand({ force });
    }
    case "doc": {
      const type = rest[0] ?? "";
      const brief = rest.slice(1).filter((a) => !a.startsWith("--")).join(" ");
      return await runDocCommand({ type, brief });
    }
    case "status": {
      return runStatusCommand();
    }
    case "publish": {
      const noCommit = rest.includes("--no-commit");
      const filename = rest.find((a) => !a.startsWith("--"));
      return runPublishCommand({ filename, noCommit });
    }
    case "discard": {
      const filename = rest[0];
      return runDiscardCommand(filename ?? "");
    }
    default: {
      process.stderr.write(`Unknown command: ${cmd}\n\n${HELP}\n`);
      return 2;
    }
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    if (err instanceof NotAGitRepoError) {
      process.stderr.write(err.message + "\n");
      process.exit(1);
    }
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
