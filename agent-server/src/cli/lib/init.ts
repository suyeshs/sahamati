import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { repoSlug } from "./repo.js";
import { SCAFFOLD } from "./embedded.js";

export interface InitResult {
  created: string[];
  skipped: string[];
}

/**
 * Scaffold the mkdocs docs structure into `repoRoot`. Shared by the
 * `sahamati init` CLI command and the local HTTP route.
 */
export function initRepo(repoRoot: string, force = false): InitResult {
  const slug = repoSlug(repoRoot);

  const targets: Array<{ rel: string; from: string; substitute?: boolean }> = [
    { rel: "docs/index.md", from: "index.md", substitute: true },
    { rel: "mkdocs.yml", from: "mkdocs.yml", substitute: true },
    { rel: ".github/workflows/docs.yml", from: "docs-workflow.yml" },
  ];

  const created: string[] = [];
  const skipped: string[] = [];

  for (const t of targets) {
    const dest = join(repoRoot, t.rel);
    if (existsSync(dest) && !force) {
      skipped.push(t.rel);
      continue;
    }
    let content = SCAFFOLD[t.from];
    if (t.substitute) content = content.replace(/__SITE_NAME__/g, slug);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content, "utf-8");
    created.push(t.rel);
  }

  for (const keep of ["docs/.drafts/.gitkeep", "docs/projects/.gitkeep"]) {
    const p = join(repoRoot, keep);
    if (!existsSync(p)) {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, "", "utf-8");
      created.push(keep);
    }
  }

  const gitignore = join(repoRoot, ".gitignore");
  const line = "site/";
  if (!existsSync(gitignore)) {
    writeFileSync(gitignore, line + "\n", "utf-8");
    created.push(".gitignore");
  } else {
    const existing = readFileSync(gitignore, "utf-8");
    if (!existing.split("\n").some((l) => l.trim() === line)) {
      appendFileSync(gitignore, (existing.endsWith("\n") ? "" : "\n") + line + "\n");
      created.push(".gitignore (updated)");
    }
  }

  return { created, skipped };
}
