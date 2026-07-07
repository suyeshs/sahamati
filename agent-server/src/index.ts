import { readFileSync, existsSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Allow Claude Agent SDK to spawn claude subprocess even when started from a Claude Code session
delete process.env.CLAUDECODE;

// Load .env file — search upward from the binary location for agent-server/.env
const __dirname2 = dirname(fileURLToPath(import.meta.url));
const isBunBinary = __dirname2.startsWith("/$bunfs");

function findEnvFile(): string | null {
  if (!isBunBinary) {
    const p = resolve(__dirname2, "..", ".env");
    return existsSync(p) ? p : null;
  }
  // Walk up from execPath looking for agent-server/.env
  let dir = dirname(process.execPath);
  for (let i = 0; i < 10; i++) {
    const candidate = resolve(dir, "agent-server", ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Find and export the project root so all modules can use it
function findProjectRoot(): string {
  if (!isBunBinary) return resolve(__dirname2, "../..");

  // Try multiple starting points — Tauri may copy the sidecar to different locations
  const starts = [
    dirname(process.execPath),
    process.cwd(),
    dirname(process.argv[0] || ""),
  ];

  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 10; i++) {
      if (existsSync(resolve(dir, "agent-server/package.json"))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  console.warn(`[warn] Could not find project root. execPath=${process.execPath} cwd=${process.cwd()}`);
  return dirname(process.execPath);
}

// The Tauri shell pre-sets __SAHAMATI_ROOT in installed (release) builds —
// there is no repo tree to discover and execPath's dir isn't writable there.
process.env.__SAHAMATI_ROOT = process.env.__SAHAMATI_ROOT || findProjectRoot();

const envPath = findEnvFile();
let envLoaded = 0;
let envOverridden = 0;
try {
  if (envPath) {
    const envContent = readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      // .env wins over inherited env — matches `tsx --env-file=.env` behavior
      // and prevents stale values in the Tauri parent shell from masking config.
      if (process.env[key] !== undefined && process.env[key] !== value) {
        envOverridden++;
      }
      process.env[key] = value;
      envLoaded++;
    }
  }
} catch (err) {
  console.warn(`[env] Failed to read ${envPath}: ${err instanceof Error ? err.message : String(err)}`);
}
console.log(`[env] envPath=${envPath ?? "<not found>"} loaded=${envLoaded} overridden=${envOverridden} AGENT_RUNNER=${process.env.AGENT_RUNNER ?? "<unset>"}`);

// Pull secrets from sahamati-kms (no-op if KMS_URL/KMS_AUTH_TOKEN unset).
// Runs before db/server/agents are imported so process.env is populated first.
const { bootstrapSecretsFromKMS } = await import("./services/secrets-bootstrap.js");
await bootstrapSecretsFromKMS();

// PID file lives under <project-root>/data/agent-server.pid so a second instance
// can detect a still-running predecessor and replace it cleanly.
const pidDir = join(process.env.__SAHAMATI_ROOT!, "data");
const pidFile = join(pidDir, "agent-server.pid");

function isProcessAlive(pid: number): boolean {
  if (!pid || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function evictStaleAgentServer(): Promise<void> {
  if (!existsSync(pidFile)) return;
  const raw = readFileSync(pidFile, "utf-8").trim();
  const oldPid = parseInt(raw, 10);
  if (!isProcessAlive(oldPid)) return;

  console.warn(`[startup] found running agent-server PID ${oldPid}, sending SIGTERM`);
  try { process.kill(oldPid, "SIGTERM"); } catch {}

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (!isProcessAlive(oldPid)) {
      console.log(`[startup] PID ${oldPid} exited`);
      return;
    }
  }
  console.error(`[startup] PID ${oldPid} did not exit within 3s — refusing to double-bind`);
  process.exit(1);
}

function writePidFile(): void {
  mkdirSync(pidDir, { recursive: true });
  writeFileSync(pidFile, String(process.pid));
}

let shutdownInFlight = false;
function shutdown(signal: string): void {
  if (shutdownInFlight) return;
  shutdownInFlight = true;
  console.log(`[shutdown] received ${signal}, cleaning up`);
  try {
    if (existsSync(pidFile)) {
      const owner = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
      if (owner === process.pid) unlinkSync(pidFile);
    }
  } catch {}
  process.exit(0);
}

function installShutdownHandlers(): void {
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGHUP", () => shutdown("SIGHUP"));
}

// When spawned by the Tauri shell, exit if the parent dies — macOS has no
// PR_SET_PDEATHSIG, so this poll is the only way to avoid being orphaned.
function startParentHeartbeat(): void {
  const parentPid = parseInt(process.env.__SAHAMATI_PARENT_PID ?? "0", 10);
  if (!parentPid) return;
  console.log(`[heartbeat] watching parent PID ${parentPid}`);
  const interval = setInterval(() => {
    if (!isProcessAlive(parentPid)) {
      console.warn(`[heartbeat] parent ${parentPid} is gone, exiting`);
      clearInterval(interval);
      shutdown("parent-died");
    }
  }, 5000);
  interval.unref();
}

await evictStaleAgentServer();
writePidFile();
installShutdownHandlers();
startParentHeartbeat();

// Dynamic import so process.env is populated before config.ts reads it
const { initDb } = await import("./db/index.js");
const { serve } = await import("@hono/node-server");
const { default: app } = await import("./server.js");

// Initialize encrypted database + sync tracking
initDb();
const { initSyncTracking, startBackgroundSync } = await import("./sync/sync-engine.js");
initSyncTracking();

// Background drain of the sync log to the cloud worker
const backgroundSync = startBackgroundSync();
if (backgroundSync) {
  console.log("Background sync: enabled (20s interval)");
} else {
  console.log("Background sync: disabled (CLOUDFLARE_SYNC_URL/SECRET not set)");
}

// Seed built-in agents into OpenClaw workspace
const { seedBuiltInAgents } = await import("./openclaw/runner.js");
seedBuiltInAgents();

const port = Number(process.env.PORT ?? 3001);

const { getRunnerMode } = await import("./runner-config.js");
const runnerMode = getRunnerMode();

console.log(`Sahamati Agent Server starting on http://localhost:${port}`);
console.log(`Runner mode: ${runnerMode} ${runnerMode === "cli" ? "(Claude Code CLI — subscription credits)" : "(Claude Agent SDK — API credits)"}`);
console.log(`Available agents: discovery, requirements, knowledge, process-docs, evernote (OpenClaw format)`);
console.log(`Health check: http://localhost:${port}/health`);

serve({ fetch: app.fetch, port });
