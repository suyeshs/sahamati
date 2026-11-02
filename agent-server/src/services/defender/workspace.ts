// Per-run workspace isolation. Every defender run gets its own temp directory;
// nothing shares a fixed path, so scheduled multi-target runs cannot collide.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";

export interface Workspace {
  dir: string;
  dispose(): Promise<void>;
}

export async function createWorkspace(runId: string): Promise<Workspace> {
  const dir = await mkdtemp(join(tmpdir(), `sahamati-defender-${runId.slice(0, 8)}-`));
  return {
    dir,
    async dispose() {
      if (process.env.SAHAMATI_DEFENDER_KEEP_WORKSPACE === "1") {
        console.log(`[defender] keeping workspace ${dir} (SAHAMATI_DEFENDER_KEEP_WORKSPACE=1)`);
        return;
      }
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Resolve a repo-relative path and refuse anything that escapes the root. Used
 * by every tool that takes a path from the model.
 */
export function resolveInside(root: string, relPath: string): string {
  if (isAbsolute(relPath)) throw new Error(`absolute paths are not permitted: ${relPath}`);
  const abs = resolve(root, relPath);
  const rel = relative(root, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`path escapes the workspace: ${relPath}`);
  }
  return abs;
}
