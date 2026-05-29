import { spawn, execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";

const execFileAsync = promisify(execFile);

export interface ClaudeAuthStatus {
  loggedIn: boolean;
  authMethod?: string;
  apiProvider?: string;
  email?: string;
  orgId?: string;
  orgName?: string;
  subscriptionType?: string;
}

export interface ClaudeAuthResponse {
  installed: boolean;
  binary?: string;
  status?: ClaudeAuthStatus;
  error?: string;
}

const CANDIDATE_PATHS = [
  "/opt/homebrew/bin/claude",
  "/usr/local/bin/claude",
  "/usr/bin/claude",
  `${process.env.HOME ?? ""}/.npm-global/bin/claude`,
];

let cachedBinary: string | null = null;

/**
 * Resolve the `claude` executable. PATH first, then common install locations.
 * Cached for the process lifetime — restart agent-server after installing.
 */
export function resolveClaudeBinary(): string | null {
  if (cachedBinary && existsSync(cachedBinary)) return cachedBinary;
  // PATH lookup — let the OS find it
  cachedBinary = "claude";
  // Verify by trying to invoke `claude --version` in a separate check below;
  // for now, also check known absolute paths so the Tauri sidecar (which may
  // start with a stripped PATH) still finds it.
  for (const p of CANDIDATE_PATHS) {
    if (existsSync(p)) {
      cachedBinary = p;
      return cachedBinary;
    }
  }
  return cachedBinary;
}

export async function getAuthStatus(): Promise<ClaudeAuthResponse> {
  const binary = resolveClaudeBinary();
  if (!binary) {
    return { installed: false, error: "claude CLI not found on PATH" };
  }
  try {
    const { stdout } = await execFileAsync(binary, ["auth", "status", "--json"], {
      timeout: 5_000,
    });
    const status = JSON.parse(stdout) as ClaudeAuthStatus;
    return { installed: true, binary, status };
  } catch (err: unknown) {
    const e = err as { code?: string; stderr?: string; message?: string };
    if (e.code === "ENOENT") {
      return { installed: false, error: "claude CLI not found" };
    }
    return {
      installed: true,
      binary,
      error: e.stderr?.trim() || e.message || "auth status failed",
    };
  }
}

/**
 * Start the `claude auth login` flow. Returns immediately after spawning —
 * the CLI opens the user's browser. The UI should poll getAuthStatus()
 * until loggedIn flips true (or a reasonable timeout passes).
 */
export function startLogin(opts?: { email?: string; sso?: boolean }): {
  started: boolean;
  error?: string;
} {
  const binary = resolveClaudeBinary();
  if (!binary) return { started: false, error: "claude CLI not found" };
  const args = ["auth", "login"];
  if (opts?.email) args.push("--email", opts.email);
  if (opts?.sso) args.push("--sso");
  try {
    const child = spawn(binary, args, {
      stdio: "ignore",
      detached: true,
      env: process.env,
    });
    child.unref();
    return { started: true };
  } catch (err) {
    return { started: false, error: (err as Error).message };
  }
}

export async function logout(): Promise<{ ok: boolean; error?: string }> {
  const binary = resolveClaudeBinary();
  if (!binary) return { ok: false, error: "claude CLI not found" };
  try {
    await execFileAsync(binary, ["auth", "logout"], { timeout: 10_000 });
    return { ok: true };
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    return { ok: false, error: e.stderr?.trim() || e.message || "logout failed" };
  }
}
