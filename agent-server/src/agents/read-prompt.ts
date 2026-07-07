// Prompt loading. In dev (tsx) prompts are read from src/prompts so edits
// take effect on reload. Compiled binaries and installed desktop bundles have
// no source tree on disk, so they fall back to the copies embedded at build
// time by scripts/embed-assets.mjs.

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { EMBEDDED_PROMPTS } from "./embedded-prompts.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isBunBinary = __dirname.startsWith("/$bunfs");

export function readPrompt(filename: string): string {
  if (!isBunBinary) {
    try {
      return readFileSync(join(__dirname, "../prompts", filename), "utf-8");
    } catch {
      // tsc dist builds don't copy .md files — use the embedded copy.
    }
  }
  const embedded = EMBEDDED_PROMPTS[filename];
  if (embedded === undefined) {
    throw new Error(
      `Prompt "${filename}" is not embedded — run \`bun run embed\` in agent-server/ and recompile`
    );
  }
  return embedded;
}
