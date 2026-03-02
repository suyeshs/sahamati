import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { readdirSync, readFileSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { runOrchestrator, runDirectAgent } from "./orchestrator.js";
import type { AgentRunRequest, GeneratedDoc } from "./types.js";
import authRoutes from "./auth/routes.js";
import githubAuthRoutes from "./auth/github-routes.js";
import githubApi from "./routes/github-api.js";
import { startSessionCleanup } from "./auth/session-store.js";
import { getGitHubToken } from "./auth/github-store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isBunBinary = __dirname.startsWith("/$bunfs");
const PROJECT_ROOT = isBunBinary
  ? resolve(dirname(process.execPath), "../..")
  : resolve(__dirname, "../..");
const GENERATED_DIR = join(PROJECT_ROOT, "docs/generated");

const app = new Hono();

app.use(
  "/*",
  cors({
    origin: ["http://localhost:1420", "http://localhost:5173", "http://127.0.0.1:1420"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);

// Auth routes
app.route("/", authRoutes);
app.route("/", githubAuthRoutes);
app.route("/", githubApi);
startSessionCleanup();

// Health check
app.get("/health", (c) => {
  return c.json({ status: "ok", agents: ["discovery", "requirements", "knowledge", "process-docs"] });
});

// Run orchestrator or specific agent via SSE
app.post("/api/agent/run", async (c) => {
  const body = await c.req.json<AgentRunRequest>();
  const { prompt, agentType, sessionId, userEmail } = body;

  if (!prompt) {
    return c.json({ error: "prompt is required" }, 400);
  }

  // Inject GitHub token for process-docs agent
  const prevGhToken = process.env.GH_TOKEN;
  const prevGithubToken = process.env.GITHUB_TOKEN;
  if (agentType === "process-docs" && userEmail) {
    const ghConn = getGitHubToken(userEmail);
    if (ghConn) {
      process.env.GH_TOKEN = ghConn.accessToken;
      process.env.GITHUB_TOKEN = ghConn.accessToken;
    }
  }

  return streamSSE(c, async (stream) => {
    let id = 0;

    const onMessage = async (msg: unknown) => {
      await stream.writeSSE({
        id: String(id++),
        event: "message",
        data: JSON.stringify(msg),
      });
    };

    try {
      if (agentType && agentType !== "orchestrator") {
        const agentKey = `${agentType}-agent` as "discovery-agent" | "requirements-agent" | "knowledge-agent" | "process-docs-agent";
        await runDirectAgent(agentKey, prompt, {
          sessionId,
          cwd: PROJECT_ROOT,
          onMessage,
        });
      } else {
        await runOrchestrator(prompt, {
          sessionId,
          cwd: PROJECT_ROOT,
          onMessage,
        });
      }

      await stream.writeSSE({
        id: String(id++),
        event: "done",
        data: JSON.stringify({ status: "completed" }),
      });
    } catch (error) {
      await stream.writeSSE({
        id: String(id++),
        event: "error",
        data: JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      });
    } finally {
      // Restore original env
      if (prevGhToken !== undefined) process.env.GH_TOKEN = prevGhToken;
      else delete process.env.GH_TOKEN;
      if (prevGithubToken !== undefined) process.env.GITHUB_TOKEN = prevGithubToken;
      else delete process.env.GITHUB_TOKEN;
    }
  });
});

// List generated documents
app.get("/api/docs/generated", (c) => {
  const docs: GeneratedDoc[] = [];
  const categories = ["business", "requirements", "knowledge", "process"];

  for (const category of categories) {
    const categoryDir = join(GENERATED_DIR, category);
    if (!existsSync(categoryDir)) continue;

    const files = readdirSync(categoryDir).filter((f) => f.endsWith(".md"));
    for (const filename of files) {
      const filePath = join(categoryDir, filename);
      const content = readFileSync(filePath, "utf-8");

      // Parse frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      const metadata: Record<string, string> = {};
      if (frontmatterMatch) {
        for (const line of frontmatterMatch[1].split("\n")) {
          const [key, ...valueParts] = line.split(":");
          if (key && valueParts.length) {
            metadata[key.trim()] = valueParts.join(":").trim().replace(/^["']|["']$/g, "");
          }
        }
      }

      docs.push({
        filename,
        category,
        path: filePath,
        title: metadata.title,
        generatedBy: metadata.generated_by,
        date: metadata.date,
        requiresReview: metadata.requires_review === "true",
        confidence: metadata.confidence ? parseFloat(metadata.confidence) : undefined,
      });
    }
  }

  return c.json({ docs });
});

// Get a specific generated document
app.get("/api/docs/generated/:category/:filename", (c) => {
  const { category, filename } = c.req.param();
  const filePath = join(GENERATED_DIR, category, filename);

  if (!existsSync(filePath)) {
    return c.json({ error: "Document not found" }, 404);
  }

  const content = readFileSync(filePath, "utf-8");
  return c.json({ content, path: filePath });
});

export default app;
