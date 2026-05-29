import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { readdirSync, readFileSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { runOrchestrator, runDirectAgent } from "./orchestrator.js";
import type { AgentRunRequest, GeneratedDoc, NewOpenClawAgentRequest, UpdateOpenClawAgentRequest } from "./types.js";
import authRoutes from "./auth/routes.js";
import githubAuthRoutes from "./auth/github-routes.js";
import githubApi from "./routes/github-api.js";
import userRoutes from "./routes/users.js";
import projectRoutes from "./routes/projects.js";
import syncRoutes from "./routes/sync.js";
import twoFactorRoutes from "./routes/two-factor.js";
import videoRoutes from "./routes/videos.js";
import claudecodeAuthRoutes from "./routes/claudecode-auth.js";
import secretsRoutes from "./routes/secrets.js";
import deploymentRoutes from "./routes/deployments.js";
import localDocsRoutes from "./routes/local-docs.js";
import { startSessionCleanup } from "./auth/session-store.js";
import { getGitHubToken } from "./auth/github-store.js";
import * as openclawRunner from "./openclaw/runner.js";
import { searchSkills as searchClawHubSkills, getSkillDetail } from "./openclaw/skill-hub.js";
import { getRunnerMode } from "./runner-config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = process.env.__SAHAMATI_ROOT || resolve(__dirname, "../..");
const GENERATED_DIR = join(PROJECT_ROOT, "docs/generated");

const app = new Hono();

app.use(
  "/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-User-Email"],
  })
);

// Auth routes
app.route("/", authRoutes);
app.route("/", githubAuthRoutes);
app.route("/api/github", githubApi);

// User, project, and sync routes
app.route("/", userRoutes);
app.route("/", projectRoutes);
app.route("/", syncRoutes);
app.route("/", twoFactorRoutes);
app.route("/", videoRoutes);
app.route("/", claudecodeAuthRoutes);
app.route("/", secretsRoutes);
app.route("/", deploymentRoutes);
app.route("/", localDocsRoutes);

startSessionCleanup();

// Health check
app.get("/health", (c) => {
  const openclawAgents = openclawRunner.listAgents();
  return c.json({
    status: "ok",
    agents: ["discovery", "requirements", "knowledge", "process-docs", "evernote", "security", "video"],
    openclawAgentCount: openclawAgents.length,
    runnerMode: getRunnerMode(),
  });
});

// Run orchestrator or specific agent via SSE
app.post("/api/agent/run", async (c) => {
  const body = await c.req.json<AgentRunRequest>();
  const { prompt, agentType, openclawAgent, sessionId, userEmail } = body;

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

  // Evernote agent uses EVERNOTE_DEV_TOKEN from .env (loaded at startup)

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
      if (agentType === "openclaw" && openclawAgent) {
        await openclawRunner.runAgent(openclawAgent, prompt, {
          sessionId,
          onMessage,
        });
      } else if (agentType && agentType !== "orchestrator" && agentType !== "openclaw") {
        const agentKey = `${agentType}-agent` as "discovery-agent" | "requirements-agent" | "knowledge-agent" | "process-docs-agent" | "evernote-agent" | "security-agent" | "video-agent";
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

// ---- OpenClaw Agent CRUD ----

app.get("/api/openclaw/agents", (c) => {
  return c.json({ agents: openclawRunner.listAgents() });
});

app.post("/api/openclaw/agents", async (c) => {
  try {
    const body = await c.req.json<NewOpenClawAgentRequest>();
    if (!body.name) return c.json({ error: "name is required" }, 400);
    const agent = openclawRunner.createAgent(body);
    return c.json({ agent }, 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

app.get("/api/openclaw/agents/:name", (c) => {
  const agent = openclawRunner.getAgent(c.req.param("name"));
  if (!agent) return c.json({ error: "Agent not found" }, 404);
  return c.json({ agent });
});

app.put("/api/openclaw/agents/:name", async (c) => {
  const body = await c.req.json<UpdateOpenClawAgentRequest>();
  const agent = openclawRunner.updateAgent(c.req.param("name"), body);
  if (!agent) return c.json({ error: "Agent not found" }, 404);
  return c.json({ agent });
});

app.delete("/api/openclaw/agents/:name", (c) => {
  const deleted = openclawRunner.deleteAgent(c.req.param("name"));
  if (!deleted) return c.json({ error: "Agent not found" }, 404);
  return c.json({ ok: true });
});

// Run a specific OpenClaw agent via SSE
app.post("/api/openclaw/agents/:name/run", async (c) => {
  const { prompt } = await c.req.json<{ prompt: string }>();
  const name = c.req.param("name");

  if (!prompt) return c.json({ error: "prompt is required" }, 400);

  return streamSSE(c, async (stream) => {
    let id = 0;
    try {
      await openclawRunner.runAgent(name, prompt, {
        onMessage: async (msg) => {
          await stream.writeSSE({ id: String(id++), event: "message", data: JSON.stringify(msg) });
        },
      });
      await stream.writeSSE({ id: String(id++), event: "done", data: JSON.stringify({ status: "completed" }) });
    } catch (error) {
      await stream.writeSSE({
        id: String(id++),
        event: "error",
        data: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      });
    }
  });
});

// ---- OpenClaw Skills ----

app.get("/api/openclaw/agents/:name/skills", (c) => {
  return c.json({ skills: openclawRunner.listSkills(c.req.param("name")) });
});

app.post("/api/openclaw/agents/:name/skills", async (c) => {
  const { filename, content, clawHubId } = await c.req.json<{
    filename?: string;
    content?: string;
    clawHubId?: string;
  }>();

  const agentName = c.req.param("name");

  if (clawHubId) {
    const detail = await getSkillDetail(clawHubId);
    if (!detail) return c.json({ error: "Skill not found on ClawHub" }, 404);
    openclawRunner.installSkill(agentName, detail.name, detail.content);
    return c.json({ ok: true, filename: `SKILL-${detail.name}.md` }, 201);
  }

  if (!filename || !content) {
    return c.json({ error: "filename and content are required" }, 400);
  }

  openclawRunner.installSkill(agentName, filename, content);
  return c.json({ ok: true }, 201);
});

app.get("/api/openclaw/agents/:name/skills/:filename", (c) => {
  const content = openclawRunner.getSkillContent(c.req.param("name"), c.req.param("filename"));
  if (content === null) return c.json({ error: "Skill not found" }, 404);
  return c.json({ content });
});

app.put("/api/openclaw/agents/:name/skills/:filename", async (c) => {
  const { content } = await c.req.json<{ content: string }>();
  if (!content) return c.json({ error: "content is required" }, 400);
  const agentName = c.req.param("name");
  const filename = c.req.param("filename");
  const existing = openclawRunner.getSkillContent(agentName, filename);
  if (existing === null) return c.json({ error: "Skill not found" }, 404);
  const skillName = filename.replace(/^SKILL-/, "").replace(/\.md$/, "");
  openclawRunner.installSkill(agentName, skillName, content);
  return c.json({ ok: true });
});

app.delete("/api/openclaw/agents/:name/skills/:filename", (c) => {
  const removed = openclawRunner.removeSkill(c.req.param("name"), c.req.param("filename"));
  if (!removed) return c.json({ error: "Skill not found" }, 404);
  return c.json({ ok: true });
});

// ClawHub search
app.get("/api/openclaw/skills/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const skills = await searchClawHubSkills(q);
  return c.json({ skills });
});

// List generated documents
app.get("/api/docs/generated", (c) => {
  const docs: GeneratedDoc[] = [];
  const categories = ["business", "requirements", "knowledge", "process", "security"];

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
