import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rm } from "node:fs/promises";

const execFileAsync = promisify(execFile);

const CLONE_DIR = "/tmp/sahamati-process-docs-workspace";

function parseRepoUrl(input: string): { owner: string; repo: string } {
  let s = input.trim();
  s = s.replace(/^https?:\/\/(www\.)?github\.com\//, "");
  s = s.replace(/^git@github\.com:/, "");
  const parts = s.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error(`Could not parse owner/repo from: ${input}`);
  }
  return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
}

function buildCloneUrl(owner: string, repo: string): { url: string; safeUrl: string } {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const safeUrl = `https://github.com/${owner}/${repo}.git`;
  const url = token ? `https://x-access-token:${token}@github.com/${owner}/${repo}.git` : safeUrl;
  return { url, safeUrl };
}

export const githubMcpServer = createSdkMcpServer({
  name: "github",
  version: "1.0.0",
  tools: [
    tool(
      "clone_repo",
      `Shallow-clone a GitHub repository to a local working directory and return the path. ` +
        `Uses GITHUB_TOKEN or GH_TOKEN from the environment for private repos. ` +
        `Destination is a fixed workspace path; cleanup is the caller's responsibility once analysis is done.`,
      {
        url: z
          .string()
          .describe("GitHub URL (https://github.com/owner/repo, git@github.com:owner/repo) or shorthand owner/repo"),
        ref: z.string().optional().describe("Branch, tag, or commit to check out. Defaults to repo HEAD."),
      },
      async ({ url, ref }) => {
        const { owner, repo } = parseRepoUrl(url);
        const { url: cloneUrl, safeUrl } = buildCloneUrl(owner, repo);

        await rm(CLONE_DIR, { recursive: true, force: true });

        const args = ["clone", "--depth", "1"];
        if (ref) args.push("--branch", ref);
        args.push(cloneUrl, CLONE_DIR);

        try {
          await execFileAsync("git", args);
        } catch (err: any) {
          const raw = String(err.stderr || err.message || err);
          const scrubbed = raw.split(cloneUrl).join(safeUrl);
          throw new Error(`git clone failed: ${scrubbed}`);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ path: CLONE_DIR, owner, repo, ref: ref ?? null }, null, 2),
            },
          ],
        };
      },
    ),
  ],
});
