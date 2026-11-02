/**
 * Claude Code CLI runner — executes agents via the `claude` CLI subprocess
 * instead of the @anthropic-ai/claude-agent-sdk API.
 *
 * Uses Claude Code subscription credits instead of API credits.
 */
import { spawn, type ChildProcess } from "child_process";

export interface CliRunnerOptions {
  systemPrompt: string;
  allowedTools?: string[];
  cwd?: string;
  maxTurns?: number;
  /** External MCP servers (server name → --mcp-config entry). In-process SDK
   * MCP servers can't cross into the CLI subprocess, so agents that need MCP
   * tools under the cli runner provide a launchable equivalent. */
  mcpServers?: Record<string, unknown>;
  onMessage?: (msg: unknown) => void;
}

interface ClaudeStreamMessage {
  type: string;
  subtype?: string;
  content?: string;
  result?: string;
  session_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Run a prompt through the Claude Code CLI and stream messages back.
 * Mirrors the interface of `query()` from @anthropic-ai/claude-agent-sdk.
 *
 * The user prompt is sent via stdin to avoid OS argument length limits.
 * The system prompt is passed via --system-prompt arg (spawn bypasses shell
 * arg limits — the OS execve limit is ~2MB on macOS which is sufficient).
 */
export async function queryViaCli(
  prompt: string,
  options: CliRunnerOptions
): Promise<unknown[]> {
  const args = buildCliArgs(options);
  const messages: unknown[] = [];

  console.log(`[claude-cli] Starting: claude ${args.slice(0, 5).join(" ")}... (cwd: ${options.cwd})`);
  console.log(`[claude-cli] Prompt length: ${prompt.length} chars, System prompt length: ${options.systemPrompt?.length ?? 0} chars`);

  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn("claude", args, {
      cwd: options.cwd,
      env: cleanEnvForClaudeCli(process.env),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let buffer = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      // Keep the last partial line in the buffer
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const msg: ClaudeStreamMessage = JSON.parse(trimmed);
          const normalized = normalizeMessage(msg);
          messages.push(normalized);
          options.onMessage?.(normalized);
        } catch {
          // Non-JSON output (e.g., status lines) — wrap as text message
          if (trimmed) {
            const textMsg = { type: "assistant", subtype: "text", content: trimmed };
            messages.push(textMsg);
            options.onMessage?.(textMsg);
          }
        }
      }
    });

    let stderrOutput = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderrOutput += text;
      // Log stderr for debugging
      console.error(`[claude-cli] ${text.trim()}`);
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn claude CLI: ${err.message}. Is claude installed and in PATH?`));
    });

    child.on("close", (code) => {
      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const msg = JSON.parse(buffer.trim());
          const normalized = normalizeMessage(msg);
          messages.push(normalized);
          options.onMessage?.(normalized);
        } catch {
          if (buffer.trim()) {
            const textMsg = { type: "assistant", subtype: "text", content: buffer.trim() };
            messages.push(textMsg);
            options.onMessage?.(textMsg);
          }
        }
      }

      console.log(`[claude-cli] Process exited with code ${code}, ${messages.length} messages collected`);

      if (code !== 0 && code !== null) {
        const errMsg = stderrOutput.trim() || `claude CLI exited with code ${code}`;
        reject(new Error(errMsg));
      } else {
        resolve(messages);
      }
    });

    // Send the user prompt via stdin, then close to signal EOF
    child.stdin?.write(prompt, () => {
      child.stdin?.end();
    });
  });
}

/**
 * Build CLI args. The user prompt is piped via stdin (not passed as arg)
 * to handle arbitrarily long prompts safely.
 */
function buildCliArgs(options: CliRunnerOptions): string[] {
  const args: string[] = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--permission-mode", "acceptEdits",
  ];

  if (options.systemPrompt) {
    args.push("--system-prompt", options.systemPrompt);
  }

  if (options.allowedTools && options.allowedTools.length > 0) {
    args.push("--allowedTools", options.allowedTools.join(","));
  }

  if (options.maxTurns) {
    args.push("--max-turns", String(options.maxTurns));
  }

  if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
    args.push("--mcp-config", JSON.stringify({ mcpServers: options.mcpServers }));
    // Only the servers we pass — don't pick up user/project MCP config.
    args.push("--strict-mcp-config");
  }

  return args;
}

/**
 * Normalize Claude Code CLI stream-json messages to match the format
 * expected by the SSE handler (same shape as claude-agent-sdk messages).
 */
function normalizeMessage(msg: ClaudeStreamMessage): ClaudeStreamMessage {
  // Claude Code stream-json already outputs messages in a compatible format
  // with type, subtype, content fields. Just pass through.
  return msg;
}

/**
 * Strip env vars that would make the `claude` CLI route to API billing
 * instead of the user's subscription. Keeping ANTHROPIC_API_KEY in the
 * subprocess env makes claude use API credits — even when the user is
 * logged in to a Pro/Max/Teams plan via `claude /login`.
 */
export function cleanEnvForClaudeCli(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const cleaned = { ...env };
  delete cleaned.CLAUDECODE;
  delete cleaned.ANTHROPIC_API_KEY;
  delete cleaned.ANTHROPIC_AUTH_TOKEN;
  delete cleaned.CLAUDE_CODE_USE_BEDROCK;
  delete cleaned.CLAUDE_CODE_USE_VERTEX;
  return cleaned;
}

/**
 * Check if the claude CLI is available on the system.
 */
export async function isClaudeCliAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("claude", ["--version"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: cleanEnvForClaudeCli(process.env),
    });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}
