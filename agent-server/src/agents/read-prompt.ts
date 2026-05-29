// Helper to read prompt .md files that works in both dev (tsx) and compiled (bun binary) modes

import { readFileSync, existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isBunBinary = __dirname.startsWith("/$bunfs");

let promptsDir: string;

if (isBunBinary) {
  // Walk up from execPath looking for agent-server/src/prompts/
  let dir = dirname(process.execPath);
  let found = false;
  for (let i = 0; i < 10; i++) {
    const candidate = resolve(dir, "agent-server/package.json");
    if (existsSync(candidate)) {
      promptsDir = resolve(dir, "agent-server/src/prompts");
      found = true;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (!found) {
    // Fallback: assume prompts are next to the source
    promptsDir = join(__dirname, "../prompts");
  }
} else {
  promptsDir = join(__dirname, "../prompts");
}

export function readPrompt(filename: string): string {
  const filePath = join(promptsDir, filename);
  return readFileSync(filePath, "utf-8");
}
