import { readFileSync } from "node:fs";

import { publishDraft } from "../lib/publish.js";
import { findRepoRoot, repoSlug } from "../lib/repo.js";

export interface PublishCommandArgs {
  filename?: string;
  noCommit?: boolean;
}

/** Map a published draft's filename prefix to a portal document category. */
function categoryFromFilename(filename: string): string {
  const f = filename.toLowerCase();
  if (f.startsWith("brd-") || f.startsWith("intent-")) return "business";
  if (f.startsWith("story-") || f.startsWith("us-")) return "requirements";
  if (f.startsWith("architecture-") || f.startsWith("arch-")) return "process";
  if (f.startsWith("security-")) return "security";
  return "general";
}

type SyncOutcome =
  | { kind: "synced"; slug: string; pushed: number }
  | { kind: "queued"; slug: string }
  | { kind: "no-project"; slug: string }
  | { kind: "skipped"; reason: string };

/**
 * Route a freshly published doc into the project DB so it flows through sync
 * to the documentation portal, exactly like agent-generated docs.
 *
 * The project is resolved by repo slug (slugify of the repo dir name); we never
 * auto-create one. Everything here is best-effort: a missing DB key, absent
 * project, or unconfigured cloud sync degrades to a note — it never fails the
 * publish, which has already written and committed the file to the repo.
 */
async function registerForSync(repoRoot: string, publishRel: string): Promise<SyncOutcome> {
  const slug = repoSlug(repoRoot);

  let content: string;
  try {
    content = readFileSync(`${repoRoot}/${publishRel}`, "utf-8");
  } catch (err) {
    return { kind: "skipped", reason: err instanceof Error ? err.message : String(err) };
  }

  try {
    // Imported lazily: the repo-only publish path (and the DB-free local HTTP
    // route that shares lib/publish.ts) must not pull in the database or sync
    // engine unless we're actually registering a doc.
    const { initDb } = await import("../../db/index.js");
    const { getProjectBySlug } = await import("../../db/repositories/project-repo.js");
    const { createDocument } = await import("../../db/repositories/document-repo.js");
    const { recordChange, initSyncTracking, syncWithCloud } = await import(
      "../../sync/sync-engine.js"
    );

    initDb();
    initSyncTracking();

    const project = getProjectBySlug(slug);
    if (!project) return { kind: "no-project", slug };

    const filename = publishRel.split("/").pop() ?? publishRel;
    const doc = createDocument({
      projectId: project.id,
      title: filename.replace(/\.md$/, ""),
      filename,
      category: categoryFromFilename(filename),
      filePath: publishRel,
      generatedBy: "cli-publish",
      createdBy: project.created_by ?? undefined,
    });

    recordChange("documents", doc.id, "INSERT", {
      ...(doc as unknown as Record<string, unknown>),
      content,
    });

    const cloudUrl = process.env.CLOUDFLARE_SYNC_URL;
    const cloudSecret = process.env.CLOUDFLARE_SYNC_SECRET;
    if (!cloudUrl || !cloudSecret) return { kind: "queued", slug };

    const { pushed } = await syncWithCloud(cloudUrl, cloudSecret);
    return { kind: "synced", slug, pushed };
  } catch (err) {
    return { kind: "skipped", reason: err instanceof Error ? err.message : String(err) };
  }
}

export async function runPublishCommand(args: PublishCommandArgs): Promise<number> {
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

      {
        const sync = await registerForSync(repoRoot, result.publishRel!);
        switch (sync.kind) {
          case "synced":
            process.stdout.write(
              `✓ Synced to the documentation portal via project '${sync.slug}' (${sync.pushed} change${sync.pushed === 1 ? "" : "s"} pushed).\n`
            );
            break;
          case "queued":
            process.stdout.write(
              `✓ Registered with project '${sync.slug}'; cloud sync not configured — it'll sync once CLOUDFLARE_SYNC_URL/SECRET are set.\n`
            );
            break;
          case "no-project":
            process.stdout.write(
              `Note: no project named '${sync.slug}' on this device — published to the repo only, not the portal.\n` +
                `      Create a project with that slug in the app to have published docs appear in the portal.\n`
            );
            break;
          case "skipped":
            process.stdout.write(
              `Note: published to the repo, but portal registration was skipped (${sync.reason}).\n`
            );
            break;
        }
      }

      return 0;
  }
}
