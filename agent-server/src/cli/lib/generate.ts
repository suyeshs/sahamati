import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { cleanEnvForClaudeCli } from "../../claudecode/runner.js";
import { buildDraftPaths } from "./drafts.js";
import { repoSlug } from "./repo.js";
import { DOC_TYPE_LABEL, loadTemplate, type DocType } from "./templates.js";

export interface GenerateResult {
  draftRel: string;
  draftAbs: string;
  filename: string;
  content: string;
}

export interface GenerateOptions {
  onProgress?: (chunk: string) => void;
}

/**
 * Generate a documentation draft for `repoRoot` and write it to
 * docs/.drafts/. Shared by the `sahamati doc` CLI command and the local
 * HTTP route used by the desktop GUI.
 */
export async function generateDraft(
  repoRoot: string,
  type: DocType,
  brief: string,
  options: GenerateOptions = {}
): Promise<GenerateResult> {
  const slug = repoSlug(repoRoot);
  const paths = buildDraftPaths(repoRoot, type, brief, slug);
  const template = loadTemplate(type);
  const prompt = buildPrompt(type, template, brief, slug, paths.date);

  const raw = await runClaude(prompt, repoRoot, options.onProgress);
  const content = stripFences(raw);

  mkdirSync(dirname(paths.draftAbs), { recursive: true });
  writeFileSync(paths.draftAbs, content, "utf-8");

  return {
    draftRel: paths.draftRel,
    draftAbs: paths.draftAbs,
    filename: paths.filename,
    content,
  };
}

function buildPrompt(
  type: DocType,
  template: string,
  brief: string,
  slug: string,
  date: string
): string {
  return [
    `You are a senior technical writer. Produce a complete ${DOC_TYPE_LABEL[type]} by filling in the template below using the user's brief.`,
    "",
    "Rules:",
    `- Output ONLY the final markdown document. No preamble, no explanation, no code fences.`,
    "- Replace every bracketed placeholder ([Project Name], [YYYY-MM-DD], etc.) with concrete content. Where the brief lacks information, make sensible assumptions and mark them with `<!-- assumption: ... -->`.",
    "- Preserve the section structure of the template. You may add sub-sections as needed.",
    `- Use today's date: ${date}.`,
    `- Where a project name is unspecified, use: ${slug}.`,
    "- Keep frontmatter (if any) and YAML metadata intact and updated.",
    "",
    "--- TEMPLATE START ---",
    template,
    "--- TEMPLATE END ---",
    "",
    "--- USER BRIEF ---",
    brief,
    "--- END BRIEF ---",
    "",
    "Now output the completed markdown document.",
  ].join("\n");
}

function runClaude(
  prompt: string,
  cwd: string,
  onProgress?: (chunk: string) => void
): Promise<string> {
  return new Promise((resolveFn, rejectFn) => {
    const child = spawn(
      "claude",
      ["-p", "--output-format", "text", "--permission-mode", "acceptEdits"],
      {
        cwd,
        env: cleanEnvForClaudeCli(process.env),
        stdio: ["pipe", "pipe", "inherit"],
      }
    );

    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      onProgress?.(text);
    });

    child.on("error", (err) => {
      rejectFn(
        new Error(
          `Failed to spawn \`claude\`: ${err.message}. Is Claude Code installed and in PATH?`
        )
      );
    });

    child.on("close", (code) => {
      if (code !== 0 && code !== null) {
        rejectFn(new Error(`claude exited with code ${code}`));
      } else {
        resolveFn(stdout);
      }
    });

    child.stdin?.write(prompt, () => child.stdin?.end());
  });
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/);
  if (fence) return fence[1].trim() + "\n";
  return trimmed + "\n";
}
